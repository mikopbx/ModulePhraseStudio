<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 *
 * One-shot voice catalogue refresher.
 *
 * Pulls the authoritative `voices.json` published by the Piper project
 * (https://huggingface.co/rhasspy/piper-voices/raw/main/voices.json),
 * normalises each entry into the flat row shape `PiperVoicesCatalog`
 * exposes to the rest of the module, and writes the result to
 * `db/voices-catalog.json` atomically.
 *
 * Invoked via `Processes::mwExecBg` from `PhraseStudioConf::onAfterModuleEnable`
 * so module enable returns immediately while the ~225 KB index downloads in
 * the background. Failures are non-fatal: the existing cache (or the
 * hardcoded fallback) keeps serving requests.
 *
 * The script is also safe to re-run manually for ad-hoc refreshes —
 * writes go through a `*.tmp` + `rename()` so a partial download can never
 * corrupt the live cache.
 */

namespace Modules\ModulePhraseStudio\Lib\Cli;

require_once 'Globals.php';

use MikoPBX\Common\Handlers\CriticalErrorsHandler;
use Modules\ModulePhraseStudio\Lib\Engines\PiperVoicesCatalog;
use Modules\ModulePhraseStudio\Lib\PhraseStudioMain;

if (PHP_SAPI !== 'cli') {
    return;
}

cli_set_process_title('PhraseStudio:refresh-voices-catalog');

try {
    (new PhraseStudioMain())->ensureStorageLayout();

    // Use the file_get_contents stream — curl invocation here would add
    // process-spawn overhead for a 225 KB download and we're already in
    // a detached php process so blocking is fine.
    $context = stream_context_create([
        'http' => [
            'timeout'    => 60,
            'user_agent' => 'MikoPBX-ModulePhraseStudio/1.x catalogue refresher',
        ],
    ]);
    $body = @file_get_contents(PiperVoicesCatalog::UPSTREAM_INDEX_URL, false, $context);
    if ($body === false || $body === '') {
        fwrite(STDERR, "voices.json download failed\n");
        exit(1);
    }

    $upstream = json_decode($body, true);
    if (!is_array($upstream) || empty($upstream)) {
        fwrite(STDERR, "voices.json malformed\n");
        exit(1);
    }

    $rows = [];
    foreach ($upstream as $upstreamKey => $entry) {
        if (!is_array($entry)) {
            continue;
        }
        // The upstream JSON is keyed by voice_id at the top level AND each
        // entry repeats it as `entry[key]`. Pass the outer key as a
        // fallback so an upstream shape change (rename / drop the inner
        // field) still produces a usable catalogue.
        $row = normalise($entry, (string)$upstreamKey);
        if ($row !== null) {
            $rows[] = $row;
        }
    }
    if (empty($rows)) {
        fwrite(STDERR, "voices.json contained no parseable entries\n");
        exit(1);
    }

    // Stable order: language tag, then voice name, mirrors PiperVoicesCatalog::sortRows.
    usort($rows, static fn(array $a, array $b): int =>
        strcmp($a['language'] . $a['voice_name'], $b['language'] . $b['voice_name'])
    );

    $cachePath = PiperVoicesCatalog::cachePath();
    $tmpPath   = $cachePath . '.tmp';
    if (@file_put_contents($tmpPath, json_encode($rows, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)) === false) {
        fwrite(STDERR, "Failed to write cache tmp file: $tmpPath\n");
        exit(1);
    }
    if (!@rename($tmpPath, $cachePath)) {
        @unlink($tmpPath);
        fwrite(STDERR, "Failed to atomic-rename cache file\n");
        exit(1);
    }
} catch (\Throwable $e) {
    CriticalErrorsHandler::handleExceptionWithSyslog($e);
    exit(1);
}

/**
 * Translates a single `voices.json` entry into the catalogue row layout.
 *
 * Upstream shape (relevant fields):
 *   {
 *     "key": "ru_RU-irina-medium",
 *     "name": "irina",
 *     "language": { "code": "ru_RU", "family": "ru", "name_english": "Russian", "country_english": "Russia" },
 *     "quality": "medium",
 *     "files": { "ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx": { "size_bytes": 63201294, "md5_digest": "…" }, ... },
 *     ...
 *   }
 *
 * The .onnx URL is reconstructed from the file path key, not from `key`,
 * because the path encodes the upstream directory layout authoritatively
 * (no need to guess the {lang}/{locale}/{name}/{quality} mapping).
 *
 * Sample rate is not in voices.json — Piper-low models are 16 000 Hz by
 * convention, all others 22 050 Hz. We use `quality` as the proxy.
 *
 * @param array<string, mixed> $entry
 * @return array<string, mixed>|null
 */
function normalise(array $entry, string $fallbackKey = ''): ?array
{
    $voiceId = (string)($entry['key'] ?? $fallbackKey);
    $name    = (string)($entry['name'] ?? '');
    $quality = (string)($entry['quality'] ?? '');
    if ($voiceId === '' || $name === '' || $quality === '') {
        return null;
    }

    $lang = (array)($entry['language'] ?? []);
    $code = (string)($lang['code'] ?? '');
    if ($code === '') {
        return null;
    }

    $files = (array)($entry['files'] ?? []);
    [$onnxPath, $configPath] = pickPaths($files, $voiceId);
    if ($onnxPath === '' || $configPath === '') {
        return null;
    }

    $modelUrl  = PiperVoicesCatalog::HUGGINGFACE_BASE . '/' . $onnxPath;
    $configUrl = PiperVoicesCatalog::HUGGINGFACE_BASE . '/' . $configPath;

    return [
        'voice_id'       => $voiceId,
        'language'       => str_replace('_', '-', strtolower($code)),
        'language_label' => formatLanguageLabel($lang),
        'voice_name'     => ucfirst($name),
        'quality'        => $quality,
        'sample_rate'    => $quality === 'low' || $quality === 'x_low' ? 16000 : 22050,
        'model_url'      => $modelUrl,
        'config_url'     => $configUrl,
    ];
}

/**
 * Returns [onnxPath, configPath] from the upstream files map.
 *
 * @param array<string, mixed> $files
 * @return array{0: string, 1: string}
 */
function pickPaths(array $files, string $voiceId): array
{
    $onnx = '';
    $cfg  = '';
    foreach (array_keys($files) as $path) {
        $path = (string)$path;
        // Match by tail "/<voiceId>.onnx" / ".onnx.json" so a missing or
        // renamed file (rare but possible during upstream churn) is detected.
        if (str_ends_with($path, '/' . $voiceId . '.onnx')) {
            $onnx = $path;
        } elseif (str_ends_with($path, '/' . $voiceId . '.onnx.json')) {
            $cfg = $path;
        }
    }
    return [$onnx, $cfg];
}

/**
 * Builds the human-readable language column the UI shows.
 * Uses `name_english`, optionally suffixed by the country when the
 * language has multiple region variants (English, Spanish, Portuguese).
 *
 * @param array<string, mixed> $lang
 */
function formatLanguageLabel(array $lang): string
{
    $name    = trim((string)($lang['name_english'] ?? $lang['code'] ?? '?'));
    $country = trim((string)($lang['country_english'] ?? ''));
    if ($country === '' || stripos($name, $country) !== false) {
        return $name;
    }
    return sprintf('%s (%s)', $name, $country);
}
