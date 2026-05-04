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

        $url       = sprintf(
            '%s/%s/piper_linux_%s.tar.gz',
            self::RELEASE_BASE_URL,
            self::RELEASE_VERSION,
            $arch
        );
        $tarball   = $piperDir . '/piper.tar.gz';

        $download = $this->downloadFile($url, $tarball);
        if (!$download['success']) {
            @unlink($tarball);
            return $download;
        }

        $extract = $this->extractTarball($tarball, $piperDir);
        @unlink($tarball);
        if (!$extract['success']) {
            return $extract;
        }

        $bin = $piperDir . '/piper/piper';
        if (!is_file($bin)) {
            return [
                'success' => false,
                'message' => 'Extracted archive did not contain piper/piper binary',
            ];
        }
        @chmod($bin, 0o755);

        return [
            'success' => true,
            'message' => 'Engine installed',
            'version' => $this->getVersion(),
        ];
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
