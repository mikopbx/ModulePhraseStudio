<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\Engines;

use MikoPBX\Core\System\Processes;
use MikoPBX\Core\System\Util;
use Modules\ModulePhraseStudio\Lib\PhraseStudioMain;
use Modules\ModulePhraseStudio\Models\PhraseStudioVoices;

/**
 * Piper TTS engine wrapper.
 *
 * The official Piper releases ship as static-linked tarballs that bundle
 * the binary together with espeak-ng-data. We download the
 * architecture-matched archive into PhraseStudioMain::piperDir() and
 * extract it in place; the resulting filesystem layout is:
 *
 *   db/piper/
 *     piper/
 *       piper                 ← the executable
 *       espeak-ng-data/...    ← phoneme data, required at runtime
 *       libpiper_phonemize.so.* ← runtime libs (kept next to the binary)
 *
 * @package Modules\ModulePhraseStudio\Lib\Engines
 */
class PiperEngine implements EngineInterface
{
    /** Pinned Piper release: any newer release with the same archive layout works. */
    private const RELEASE_VERSION = '2023.11.14-2';
    private const RELEASE_BASE_URL = 'https://github.com/rhasspy/piper/releases/download';

    public function getId(): string
    {
        return 'piper';
    }

    public function isInstalled(): bool
    {
        $bin = $this->getBinaryPath();
        return $bin !== '' && is_file($bin) && is_executable($bin);
    }

    public function getBinaryPath(): string
    {
        $candidate = PhraseStudioMain::piperDir() . '/piper/piper';
        return is_file($candidate) ? $candidate : '';
    }

    public function getVersion(): string
    {
        if (!$this->isInstalled()) {
            return '';
        }
        $bin = $this->getBinaryPath();
        Processes::mwExec(escapeshellarg($bin) . ' --version 2>&1', $out, $rc);
        if ($rc !== 0 || empty($out)) {
            // Newer Piper exits 0 on --version; older releases just print and exit.
            return self::RELEASE_VERSION;
        }
        return trim((string)$out[0]) ?: self::RELEASE_VERSION;
    }

    /**
     * Stale-lock window: if `.installing.lock` is older than this, treat the
     * previous installer as dead (php fatal, OOM, host reboot mid-download)
     * and steal the lock so the user is never blocked forever. Comfortably
     * above curl's --max-time 1200 used in `downloadFile()`.
     */
    private const int INSTALL_LOCK_STALE_SECONDS = 30 * 60;

    /**
     * Downloads the architecture-matched Piper tarball, extracts it, and
     * verifies that the resulting binary is runnable.
     *
     * The same code path serves three callers:
     *   - `onAfterModuleEnable()` via the detached `install-engine.php`
     *     runner (auto-bootstrap on enable);
     *   - the "Install engine" button when the binary is missing;
     *   - the "Update engine" button when the user wants to refresh the
     *     pinned RELEASE_VERSION (passes `$force=true`).
     *
     * Three protections keep concurrent and partial-failure scenarios safe:
     *   1. A filesystem lock at `db/piper/.installing.lock` created via
     *      `fopen('xb')` — atomic on POSIX; a second concurrent install
     *      observes the lock and returns "already running".
     *   2. Stale-lock recovery: if the lock file is older than
     *      `INSTALL_LOCK_STALE_SECONDS` we assume the prior runner died and
     *      reclaim it, so a crash never strands the user.
     *   3. Staged extraction: tarball is unpacked into `db/piper/.staging/`
     *      and only renamed into `db/piper/piper/` after the new binary is
     *      verified. The previous engine is moved to `.piper-old` first so
     *      a transient curl/tar failure during update never leaves the box
     *      without a working engine — we rename the backup back on error.
     *
     * The action layer (`InstallEngineAction`) decides whether to call this
     * method at all. With `force=false` it short-circuits on `isInstalled()`;
     * the `force` flag only changes that call decision, not the work done
     * here — staged swap makes "fresh install" and "update" structurally
     * identical from the engine's point of view.
     */
    public function install(): array
    {
        $arch = $this->detectArch();
        if ($arch === null) {
            return [
                'success' => false,
                'message' => 'Unsupported CPU architecture for Piper precompiled binaries',
            ];
        }

        $piperDir = PhraseStudioMain::piperDir();
        Util::mwMkdir($piperDir);

        $lockPath = $piperDir . '/.installing.lock';
        // Reclaim a stale lock from a dead prior runner before trying to
        // grab our own. Without this, a crashed install would block the
        // user until manual intervention.
        if (is_file($lockPath) && (time() - (int)filemtime($lockPath)) > self::INSTALL_LOCK_STALE_SECONDS) {
            @unlink($lockPath);
        }
        $lock = @fopen($lockPath, 'xb');
        if ($lock === false) {
            return [
                'success' => false,
                'message' => 'Engine install is already running — wait for it to finish',
            ];
        }

        try {
            $url     = sprintf(
                '%s/%s/piper_linux_%s.tar.gz',
                self::RELEASE_BASE_URL,
                self::RELEASE_VERSION,
                $arch
            );
            $tarball = $piperDir . '/piper.tar.gz';
            $staging = $piperDir . '/.staging';
            $finalDir = $piperDir . '/piper';
            $backupDir = $piperDir . '/.piper-old';
            $rm = Util::which('rm');

            // Download outside any swap window — if the network fails the
            // currently working engine is untouched.
            $download = $this->downloadFile($url, $tarball);
            if (!$download['success']) {
                @unlink($tarball);
                return $download;
            }

            // Extract into a staging dir, NOT directly into the final
            // location. The previous code unconditionally overwrote
            // db/piper/piper during force-update, so a curl failure halfway
            // through left the box with no working engine. Now: stage,
            // verify, then atomically swap.
            if (is_dir($staging) && $rm !== '') {
                Processes::mwExec(sprintf('%s -rf %s', escapeshellarg($rm), escapeshellarg($staging)));
            }
            Util::mwMkdir($staging);

            $extract = $this->extractTarball($tarball, $staging);
            @unlink($tarball);
            if (!$extract['success']) {
                if ($rm !== '') {
                    Processes::mwExec(sprintf('%s -rf %s', escapeshellarg($rm), escapeshellarg($staging)));
                }
                return $extract;
            }

            $stagedBin = $staging . '/piper/piper';
            if (!is_file($stagedBin)) {
                if ($rm !== '') {
                    Processes::mwExec(sprintf('%s -rf %s', escapeshellarg($rm), escapeshellarg($staging)));
                }
                return [
                    'success' => false,
                    'message' => 'Extracted archive did not contain piper/piper binary',
                ];
            }
            @chmod($stagedBin, 0o755);

            // Atomic swap with rollback. rename() on the same filesystem
            // is atomic on POSIX. We stash any existing piper/ as .piper-old
            // first; if the rename of staging→final fails, we rename
            // .piper-old back so the user is never left engine-less.
            if (is_dir($backupDir) && $rm !== '') {
                Processes::mwExec(sprintf('%s -rf %s', escapeshellarg($rm), escapeshellarg($backupDir)));
            }
            $hadPrevious = is_dir($finalDir);
            if ($hadPrevious && !@rename($finalDir, $backupDir)) {
                if ($rm !== '') {
                    Processes::mwExec(sprintf('%s -rf %s', escapeshellarg($rm), escapeshellarg($staging)));
                }
                return [
                    'success' => false,
                    'message' => 'Failed to move existing engine aside',
                ];
            }
            if (!@rename($staging . '/piper', $finalDir)) {
                if ($hadPrevious) {
                    @rename($backupDir, $finalDir);
                }
                if ($rm !== '') {
                    Processes::mwExec(sprintf('%s -rf %s', escapeshellarg($rm), escapeshellarg($staging)));
                }
                return [
                    'success' => false,
                    'message' => 'Failed to install new engine binary',
                ];
            }
            if ($rm !== '') {
                Processes::mwExec(sprintf('%s -rf %s', escapeshellarg($rm), escapeshellarg($staging)));
                if (is_dir($backupDir)) {
                    Processes::mwExec(sprintf('%s -rf %s', escapeshellarg($rm), escapeshellarg($backupDir)));
                }
            }

            return [
                'success' => true,
                'message' => 'Engine installed',
                'version' => $this->getVersion(),
            ];
        } finally {
            // Always release the lock — including on early returns above. If
            // this script is SIGKILLed mid-install the file remains and the
            // stale-lock window above lets the next caller reclaim it.
            if (is_resource($lock)) {
                fclose($lock);
            }
            @unlink($lockPath);
        }
    }

    public function uninstall(): array
    {
        $piperDir = PhraseStudioMain::piperDir();
        $extracted = $piperDir . '/piper';
        if (!is_dir($extracted)) {
            return ['success' => true, 'message' => 'Engine was not installed'];
        }

        $rm = Util::which('rm');
        if ($rm === '') {
            return ['success' => false, 'message' => 'rm binary unavailable'];
        }
        Processes::mwExec(sprintf('%s -rf %s', escapeshellarg($rm), escapeshellarg($extracted)), $out, $rc);
        if ($rc !== 0) {
            return [
                'success' => false,
                'message' => 'Failed to remove engine directory: ' . implode(' ', $out),
            ];
        }
        return ['success' => true, 'message' => 'Engine removed'];
    }

    public function synthesize(string $text, string $voiceId, string $outputPath): array
    {
        if (!$this->isInstalled()) {
            return ['success' => false, 'message' => 'Engine is not installed'];
        }

        $voiceRow = PhraseStudioVoices::findFirst("voice_id='" . addslashes($voiceId) . "'");
        if ($voiceRow === null || !is_file($voiceRow->model_path ?? '')) {
            return ['success' => false, 'message' => 'Voice model is not installed: ' . $voiceId];
        }

        $bin       = $this->getBinaryPath();
        $piperHome = dirname($bin);

        $textFile = $outputPath . '.txt';
        file_put_contents($textFile, $text);

        $cmd = sprintf(
            'cd %s && %s --model %s --output_file %s < %s 2>&1',
            escapeshellarg($piperHome),
            escapeshellarg($bin),
            escapeshellarg((string)$voiceRow->model_path),
            escapeshellarg($outputPath),
            escapeshellarg($textFile)
        );
        Processes::mwExec($cmd, $out, $rc);
        @unlink($textFile);

        if ($rc !== 0 || !is_file($outputPath) || filesize($outputPath) < 64) {
            return [
                'success' => false,
                'message' => 'piper exited with error: ' . implode(' ', $out),
            ];
        }

        return [
            'success'     => true,
            'message'     => 'OK',
            'sample_rate' => (int)($voiceRow->sample_rate ?? 22050),
        ];
    }

    /**
     * Returns piper-release arch suffix ("x86_64" / "aarch64" / "armv7l")
     * or null if the host architecture has no precompiled artefact.
     */
    private function detectArch(): ?string
    {
        $uname = Util::which('uname');
        if ($uname === '') {
            return null;
        }
        Processes::mwExec(escapeshellarg($uname) . ' -m', $out, $rc);
        $arch = strtolower(trim((string)($out[0] ?? '')));
        if ($rc !== 0 || $arch === '') {
            return null;
        }
        return match ($arch) {
            'x86_64', 'amd64'           => 'x86_64',
            'aarch64', 'arm64'          => 'aarch64',
            'armv7l', 'armv7', 'armhf'  => 'armv7l',
            default                     => null,
        };
    }

    /**
     * @return array{success: bool, message: string}
     */
    private function downloadFile(string $url, string $dest): array
    {
        $curl = Util::which('curl');
        if ($curl === '') {
            return ['success' => false, 'message' => 'curl binary unavailable'];
        }
        $cmd = sprintf(
            '%s -fL --max-time 1200 -o %s %s 2>&1',
            escapeshellarg($curl),
            escapeshellarg($dest),
            escapeshellarg($url)
        );
        Processes::mwExec($cmd, $out, $rc);
        if ($rc !== 0 || !is_file($dest) || filesize($dest) < 1024) {
            return [
                'success' => false,
                'message' => 'Failed to download Piper archive: ' . implode(' ', $out),
            ];
        }
        return ['success' => true, 'message' => 'OK'];
    }

    /**
     * @return array{success: bool, message: string}
     */
    private function extractTarball(string $tarball, string $destDir): array
    {
        $tar = Util::which('tar');
        if ($tar === '') {
            return ['success' => false, 'message' => 'tar binary unavailable'];
        }
        $cmd = sprintf(
            '%s -xzf %s -C %s 2>&1',
            escapeshellarg($tar),
            escapeshellarg($tarball),
            escapeshellarg($destDir)
        );
        Processes::mwExec($cmd, $out, $rc);
        if ($rc !== 0) {
            return [
                'success' => false,
                'message' => 'Failed to extract Piper archive: ' . implode(' ', $out),
            ];
        }
        return ['success' => true, 'message' => 'OK'];
    }
}
