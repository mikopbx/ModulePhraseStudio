<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib;

use MikoPBX\Core\System\Processes;
use MikoPBX\Core\System\Util;
use MikoPBX\Modules\PbxExtensionUtils;
use Modules\ModulePhraseStudio\Lib\Engines\PiperEngine;
use Modules\ModulePhraseStudio\Lib\Engines\PiperVoicesCatalog;
use Modules\ModulePhraseStudio\Models\ModulePhraseStudio as SettingsModel;
use Modules\ModulePhraseStudio\Models\PhraseStudioPhrases;
use Modules\ModulePhraseStudio\Models\PhraseStudioVoices;

/**
 * Coordinator class for the studio:
 *   - exposes filesystem layout used by Engine + Voices + Phrases
 *   - wraps the synthesis pipeline (cache lookup -> piper -> optional sox)
 *   - manages voice model downloads and removal
 *
 * Splitting filesystem helpers into static methods (piperDir/voicesDir/...)
 * keeps PiperEngine free of model lookups and lets Action classes resolve
 * paths without instantiating Main.
 *
 * @package Modules\ModulePhraseStudio\Lib
 */
class PhraseStudioMain
{
    public const MODULE_UNIQUE_ID = 'ModulePhraseStudio';


    /**
     * Returns the persistent module directory (db/ symlink target).
     */
    public static function moduleStorage(): string
    {
        return PbxExtensionUtils::getModuleDir(self::MODULE_UNIQUE_ID) . '/db';
    }

    public static function piperDir(): string
    {
        return self::moduleStorage() . '/piper';
    }

    public static function voicesDir(): string
    {
        return self::moduleStorage() . '/voices';
    }

    public static function phrasesDir(): string
    {
        return self::moduleStorage() . '/phrases';
    }

    /**
     * Creates persistent storage subdirectories. Called from
     * PhraseStudioConf::onAfterModuleEnable() and lazily from Actions.
     */
    public function ensureStorageLayout(): void
    {
        Util::mwMkdir(self::piperDir());
        Util::mwMkdir(self::voicesDir());
        Util::mwMkdir(self::phrasesDir());
    }

    /**
     * Loads (or seeds) the singleton settings row.
     */
    public function getSettings(): SettingsModel
    {
        $settings = SettingsModel::findFirst();
        if ($settings === null) {
            $settings = new SettingsModel();
            $settings->default_voice          = '';
            $settings->default_sample_rate    = 'native';
            $settings->resample_for_telephony = '0';
            $settings->max_text_length        = '800';
            $settings->cache_size_limit       = '500';
            $settings->save();
        }
        return $settings;
    }

    /**
     * Stages an asynchronous voice download.
     *
     * Inserts (or resets) the row to `install_status='installing'` and
     * detaches a one-shot PHP script that runs `executeVoiceInstall()`.
     * Returns immediately so the REST handler can respond with 202 —
     * the actual curl download (30 s – 2 min) finishes in the background
     * and the UI's poll loop watches `install_status` flip.
     *
     * We use `Processes::mwExecBg` (nohup-detached php) instead of a
     * persistent Beanstalk worker because voice installs are rare and
     * one-shot — keeping a daemon process around just to wait for the
     * occasional download is wasteful (memory, ping watchdogs, restart
     * orchestration). A short-lived `php -f install-voice.php $voiceId`
     * inherits no request lifetime and is therefore not bound by
     * WorkerApiCommands' 30-second sync timeout.
     *
     * Two-phase row lifecycle:
     *   - phase 1 (here): row exists with `install_status='installing'`,
     *     `installed_at='0'`, blank model_path / config_path / size_bytes;
     *   - phase 2 (detached script): on success all metadata fields are
     *     populated and `install_status='installed'`. On failure,
     *     `install_status='failed'` and `install_error` describes what
     *     went wrong.
     *
     * Code that asks "is this voice usable?" must check both that a row
     * exists AND `install_status` is empty (legacy) or `'installed'`.
     *
     * @return array{success: bool, message: string, voice_id?: string, queued?: bool}
     */
    public function installVoice(string $voiceId): array
    {
        $voice = PiperVoicesCatalog::find($voiceId);
        if ($voice === null) {
            return ['success' => false, 'message' => 'Unknown voice id: ' . $voiceId];
        }

        $this->ensureStorageLayout();

        $existing = PhraseStudioVoices::findFirst("voice_id='" . addslashes($voiceId) . "'");
        if ($existing !== null && $existing->install_status === 'installing') {
            return [
                'success'  => true,
                'message'  => 'Install already in progress',
                'voice_id' => $voiceId,
                'queued'   => true,
            ];
        }

        $row = $existing ?? new PhraseStudioVoices();
        $row->voice_id           = $voiceId;
        $row->language           = (string)$voice['language'];
        $row->voice_name         = (string)$voice['voice_name'];
        $row->quality            = (string)$voice['quality'];
        $row->sample_rate        = (string)$voice['sample_rate'];
        $row->install_status     = 'installing';
        $row->install_error      = '';
        $row->install_started_at = (string)time();
        // Reset metadata until the detached script actually finishes the
        // download — an "installing" row must never be treated as usable.
        $row->installed_at = '0';
        $row->model_path   = '';
        $row->config_path  = '';
        $row->size_bytes   = '0';
        $row->save();

        // Detach a short-lived `php -f install-voice.php <voice_id>`. nohup
        // keeps it alive past the REST request, stdout/stderr go to /dev/null
        // because errors are persisted on the row itself via install_error.
        $php    = Util::which('php');
        $script = __DIR__ . '/Cli/install-voice.php';
        Processes::mwExecBg(
            sprintf('%s -f %s %s', escapeshellarg($php), escapeshellarg($script), escapeshellarg($voiceId)),
            '/dev/null'
        );

        return [
            'success'  => true,
            'message'  => 'Install queued',
            'voice_id' => $voiceId,
            'queued'   => true,
        ];
    }

    /**
     * Synchronously downloads voice model files (.onnx + .onnx.json) and
     * marks the row 'installed' / 'failed'. Called from the worker only.
     *
     * @return array{success: bool, message: string}
     */
    public function executeVoiceInstall(string $voiceId): array
    {
        $voice = PiperVoicesCatalog::find($voiceId);
        $row   = PhraseStudioVoices::findFirst("voice_id='" . addslashes($voiceId) . "'");

        if ($voice === null || $row === null) {
            // Catalog mismatch or row vanished: leave whatever state exists.
            return ['success' => false, 'message' => 'Voice not in catalog or row missing: ' . $voiceId];
        }

        $this->ensureStorageLayout();

        $modelPath  = self::voicesDir() . '/' . $voiceId . '.onnx';
        $configPath = self::voicesDir() . '/' . $voiceId . '.onnx.json';

        $curl = Util::which('curl');
        if ($curl === '') {
            return self::markFailed($row, 'curl binary is not available');
        }

        foreach ([['url' => $voice['model_url'], 'dest' => $modelPath],
                  ['url' => $voice['config_url'], 'dest' => $configPath]] as $task) {
            $cmd = sprintf(
                '%s -fL --max-time 600 -o %s %s',
                escapeshellarg($curl),
                escapeshellarg($task['dest']),
                escapeshellarg($task['url'])
            );
            Processes::mwExec($cmd, $out, $rc);
            if ($rc !== 0 || !is_file($task['dest']) || filesize($task['dest']) < 256) {
                @unlink($modelPath);
                @unlink($configPath);
                return self::markFailed($row, 'Failed to download voice asset: ' . implode(' ', $out));
            }
        }

        $row->model_path     = $modelPath;
        $row->config_path    = $configPath;
        $row->size_bytes     = (string)((int)filesize($modelPath) + (int)filesize($configPath));
        $row->installed_at   = (string)time();
        $row->install_status = 'installed';
        $row->install_error  = '';
        $row->save();

        return ['success' => true, 'message' => 'Voice installed'];
    }

    /**
     * Marks the row as failed and persists the error message so the UI
     * can show it. Wrapper to keep `executeVoiceInstall` legible.
     */
    private static function markFailed(PhraseStudioVoices $row, string $message): array
    {
        $row->install_status = 'failed';
        $row->install_error  = $message;
        $row->save();
        return ['success' => false, 'message' => $message];
    }

    /**
     * Removes a voice from disk and from the DB.
     *
     * Works on rows in any state — 'installed' rows have files to clean
     * up; 'installing' / 'failed' rows have nothing on disk yet but the
     * placeholder row still needs to go so the user can re-trigger the
     * download via the install button.
     */
    public function uninstallVoice(string $voiceId): array
    {
        $row = PhraseStudioVoices::findFirst("voice_id='" . addslashes($voiceId) . "'");
        if ($row === null) {
            return ['success' => false, 'message' => 'Voice not installed'];
        }
        if (!empty($row->model_path)) {
            @unlink((string)$row->model_path);
        }
        if (!empty($row->config_path)) {
            @unlink((string)$row->config_path);
        }
        $row->delete();
        return ['success' => true, 'message' => 'Voice removed'];
    }

    /**
     * Generates (or returns cached) audio for the given text/voice/rate.
     *
     * @return array{success: bool, message: string, phrase_id?: int, file_path?: string, cache_key?: string, cached?: bool}
     */
    public function generatePhrase(string $text, string $voiceId, string $sampleRate): array
    {
        $settings = $this->getSettings();
        $maxLen   = (int)($settings->max_text_length ?? 2000);
        if ($maxLen > 0 && mb_strlen($text) > $maxLen) {
            return [
                'success' => false,
                'message' => sprintf('Text exceeds the configured limit of %d characters', $maxLen),
            ];
        }
        if (trim($text) === '') {
            return ['success' => false, 'message' => 'Text is empty'];
        }

        $voiceRow = PhraseStudioVoices::findFirst("voice_id='" . addslashes($voiceId) . "'");
        if ($voiceRow === null) {
            return [
                'success' => false,
                'message' => 'Voice is not installed: ' . $voiceId,
            ];
        }

        $rate     = self::normaliseSampleRate($sampleRate, (int)($voiceRow->sample_rate ?? 22050));
        $cacheKey = md5($text . '|' . $voiceId . '|' . $rate);
        $existing = PhraseStudioPhrases::findFirst("cache_key='" . addslashes($cacheKey) . "'");

        if ($existing !== null && is_file($existing->file_path ?? '')) {
            return [
                'success'   => true,
                'message'   => 'OK (cached)',
                'phrase_id' => (int)$existing->id,
                'file_path' => $existing->file_path,
                'cache_key' => $cacheKey,
                'cached'    => true,
            ];
        }

        $this->ensureStorageLayout();
        $rawPath   = self::phrasesDir() . '/' . $cacheKey . '_raw.wav';
        $finalPath = self::phrasesDir() . '/' . $cacheKey . '.wav';

        $engine = new PiperEngine();
        $synth  = $engine->synthesize($text, $voiceId, $rawPath);
        if (!$synth['success']) {
            @unlink($rawPath);
            return $synth;
        }

        $resample = $this->resampleIfNeeded($rawPath, $finalPath, $rate);
        if (!$resample['success']) {
            @unlink($rawPath);
            @unlink($finalPath);
            return $resample;
        }

        $row = $existing ?? new PhraseStudioPhrases();
        $row->cache_key   = $cacheKey;
        $row->text        = mb_substr($text, 0, $maxLen ?: 2000);
        $row->voice_id    = $voiceId;
        $row->sample_rate = (string)$rate;
        $row->file_path   = $finalPath;
        $row->size_bytes  = (string)((int)@filesize($finalPath));
        $row->duration_ms = (string)$this->estimateDurationMs($finalPath);
        $row->created_at  = (string)time();
        $row->save();

        $this->pruneCache((int)($settings->cache_size_limit ?? 100));

        return [
            'success'   => true,
            'message'   => 'OK',
            'phrase_id' => (int)$row->id,
            'file_path' => $finalPath,
            'cache_key' => $cacheKey,
            'cached'    => false,
        ];
    }

    /**
     * Removes a single phrase from the history (DB row + file on disk).
     */
    public function deletePhrase(int $phraseId): array
    {
        $row = PhraseStudioPhrases::findFirstById($phraseId);
        if ($row === null) {
            return ['success' => false, 'message' => 'Phrase not found'];
        }
        @unlink($row->file_path ?? '');
        $row->delete();
        return ['success' => true, 'message' => 'Phrase deleted'];
    }

    /**
     * Pure helper: normalises a UI-supplied sample-rate value to a
     * concrete integer (8000 for telephony, native otherwise).
     */
    private static function normaliseSampleRate(string $sampleRate, int $nativeRate): int
    {
        $sampleRate = strtolower(trim($sampleRate));
        if ($sampleRate === 'telephony' || $sampleRate === '8000' || $sampleRate === '8khz') {
            return 8000;
        }
        if (ctype_digit($sampleRate)) {
            return (int)$sampleRate;
        }
        return $nativeRate;
    }

    /**
     * Either renames the raw file in-place (if no resample needed) or
     * runs sox to convert it.
     */
    private function resampleIfNeeded(string $rawPath, string $finalPath, int $targetRate): array
    {
        $sox = Util::which('sox');
        if ($sox === '' || $targetRate === 0) {
            return rename($rawPath, $finalPath)
                ? ['success' => true, 'message' => 'OK']
                : ['success' => false, 'message' => 'Failed to move generated file'];
        }

        $cmd = sprintf(
            '%s -G %s -c 1 -r %d -b 16 %s 2>&1',
            escapeshellarg($sox),
            escapeshellarg($rawPath),
            $targetRate,
            escapeshellarg($finalPath)
        );
        Processes::mwExec($cmd, $out, $rc);
        @unlink($rawPath);

        if ($rc !== 0 || !is_file($finalPath)) {
            return [
                'success' => false,
                'message' => 'sox resample failed: ' . implode(' ', $out),
            ];
        }
        return ['success' => true, 'message' => 'OK'];
    }

    /**
     * Best-effort duration estimate via `soxi`. Returns 0 if soxi is missing.
     */
    private function estimateDurationMs(string $wavPath): int
    {
        $soxi = Util::which('soxi');
        if ($soxi === '' || !is_file($wavPath)) {
            return 0;
        }
        Processes::mwExec(sprintf('%s -D %s 2>/dev/null', escapeshellarg($soxi), escapeshellarg($wavPath)), $out);
        $seconds = (float)($out[0] ?? 0.0);
        return (int)round($seconds * 1000);
    }

    /**
     * Drops the oldest cached phrases (DB row + file) once the cache
     * exceeds the configured limit. Limit <= 0 disables pruning.
     */
    private function pruneCache(int $limit): void
    {
        if ($limit <= 0) {
            return;
        }
        $count = PhraseStudioPhrases::count();
        if ($count <= $limit) {
            return;
        }
        $excess = $count - $limit;
        $oldest = PhraseStudioPhrases::find([
            'order' => 'created_at ASC',
            'limit' => $excess,
        ]);
        foreach ($oldest as $row) {
            @unlink($row->file_path ?? '');
            $row->delete();
        }
    }
}
