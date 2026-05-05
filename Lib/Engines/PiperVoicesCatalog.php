<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\Engines;

use Modules\ModulePhraseStudio\Lib\PhraseStudioMain;

/**
 * Catalogue of Piper voices that can be downloaded on demand.
 *
 * Two-tier source:
 *   1. **Authoritative.** `db/voices-catalog.json`, mirrored from the
 *      official Piper inventory at
 *      https://huggingface.co/rhasspy/piper-voices/raw/main/voices.json
 *      Refreshed by `Lib/Cli/refresh-voices-catalog.php` on module enable
 *      and on demand. Carries 150+ voices with metadata, file sizes and
 *      MD5 digests; that script normalises the upstream shape into the
 *      flat row layout this class produces.
 *   2. **Hardcoded fallback.** A curated subset shipped in the repo so
 *      a fresh install with no network access still has something usable.
 *      Used when the JSON cache is missing, unreadable, empty, or older
 *      than `CACHE_STALE_SECONDS` (then we still serve it but a refresh
 *      is queued elsewhere).
 *
 * Voice URLs follow Piper's published path:
 *   https://huggingface.co/rhasspy/piper-voices/resolve/main/{lang}/{lang_code}/{name}/{quality}/{voice_id}.onnx
 *
 * @package Modules\ModulePhraseStudio\Lib\Engines
 */
final class PiperVoicesCatalog
{
    public const string HUGGINGFACE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';
    public const string UPSTREAM_INDEX_URL = 'https://huggingface.co/rhasspy/piper-voices/raw/main/voices.json';

    /** Where the refresh runner writes the normalised cache. */
    public static function cachePath(): string
    {
        return PhraseStudioMain::moduleStorage() . '/voices-catalog.json';
    }

    /**
     * @return array<int, array<string, mixed>> Voice catalogue entries, sorted by language.
     */
    public static function all(): array
    {
        $cached = self::loadCache();
        if ($cached !== null) {
            return $cached;
        }
        return self::sortRows(self::fallbackEntries());
    }

    /**
     * Looks up a single voice by voice_id.
     *
     * @return array<string, mixed>|null
     */
    public static function find(string $voiceId): ?array
    {
        foreach (self::all() as $voice) {
            if ($voice['voice_id'] === $voiceId) {
                return $voice;
            }
        }
        return null;
    }

    /**
     * Reads + validates the cached normalised catalog.
     *
     * Tolerates missing / corrupt files: returns null, callers fall back
     * to `fallbackEntries()`. The cache is treated as authoritative even
     * when stale (no TTL gating here) — a separate refresh runner keeps
     * it fresh; serving slightly old data is better than serving the
     * thin hardcoded fallback while a refresh is pending.
     *
     * @return array<int, array<string, mixed>>|null
     */
    private static function loadCache(): ?array
    {
        $path = self::cachePath();
        if (!is_file($path)) {
            return null;
        }
        $raw = @file_get_contents($path);
        if ($raw === false || $raw === '') {
            return null;
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded) || empty($decoded)) {
            return null;
        }
        // Defence against partial files: each row must carry the fields
        // GetListAction shapes, otherwise drop and use the fallback.
        foreach ($decoded as $row) {
            if (!isset($row['voice_id'], $row['language'], $row['model_url'], $row['config_url'])) {
                return null;
            }
        }
        return $decoded;
    }

    /**
     * Curated subset shipped in the repo for offline / first-boot use.
     * Edit this list when adding voices that should be available even
     * without an upstream refresh — but the upstream cache, when present,
     * supersedes this entirely so a curation tweak alone does not change
     * what users see in production.
     *
     * @return array<int, array<string, mixed>>
     */
    private static function fallbackEntries(): array
    {
        $entries = [
            // Russian
            ['ru', 'ru_RU', 'irina',     'medium', 22050, 'Russian',     'Irina'],
            ['ru', 'ru_RU', 'dmitri',    'medium', 22050, 'Russian',     'Dmitri'],
            ['ru', 'ru_RU', 'denis',     'medium', 22050, 'Russian',     'Denis'],

            // English
            ['en', 'en_US', 'amy',       'medium', 22050, 'English (US)', 'Amy'],
            ['en', 'en_US', 'ryan',      'medium', 22050, 'English (US)', 'Ryan'],
            ['en', 'en_US', 'lessac',    'medium', 22050, 'English (US)', 'Lessac'],
            ['en', 'en_GB', 'alba',      'medium', 22050, 'English (GB)', 'Alba'],
            ['en', 'en_GB', 'northern_english_male', 'medium', 22050, 'English (GB)', 'Northern English Male'],

            // German
            ['de', 'de_DE', 'thorsten',  'medium', 22050, 'German',       'Thorsten'],
            ['de', 'de_DE', 'kerstin',   'low',    16000, 'German',       'Kerstin'],

            // French
            ['fr', 'fr_FR', 'siwis',     'medium', 22050, 'French',       'Siwis'],
            ['fr', 'fr_FR', 'upmc',      'medium', 22050, 'French',       'UPMC'],

            // Spanish
            ['es', 'es_ES', 'sharvard',  'medium', 22050, 'Spanish (ES)', 'Sharvard'],
            ['es', 'es_MX', 'ald',       'medium', 22050, 'Spanish (MX)', 'Ald'],

            // Italian
            ['it', 'it_IT', 'riccardo',  'x_low',  16000, 'Italian',      'Riccardo'],
            ['it', 'it_IT', 'paola',     'medium', 22050, 'Italian',      'Paola'],

            // Polish
            ['pl', 'pl_PL', 'darkman',   'medium', 22050, 'Polish',       'Darkman'],
            ['pl', 'pl_PL', 'gosia',     'medium', 22050, 'Polish',       'Gosia'],

            // Czech
            ['cs', 'cs_CZ', 'jirka',     'medium', 22050, 'Czech',        'Jirka'],

            // Dutch
            ['nl', 'nl_NL', 'mls',       'medium', 22050, 'Dutch',        'MLS'],

            // Portuguese
            ['pt', 'pt_BR', 'faber',     'medium', 22050, 'Portuguese (BR)', 'Faber'],
            ['pt', 'pt_PT', 'tugão',     'medium', 22050, 'Portuguese (PT)', 'Tugão'],

            // Ukrainian
            ['uk', 'uk_UA', 'ukrainian_tts', 'medium', 22050, 'Ukrainian', 'Ukrainian TTS'],

            // Other languages with Piper support
            ['da', 'da_DK', 'talesyntese', 'medium', 22050, 'Danish',     'Talesyntese'],
            ['sv', 'sv_SE', 'nst',       'medium', 22050, 'Swedish',      'NST'],
            ['fi', 'fi_FI', 'harri',     'medium', 22050, 'Finnish',      'Harri'],
            ['hu', 'hu_HU', 'anna',      'medium', 22050, 'Hungarian',    'Anna'],
            ['ro', 'ro_RO', 'mihai',     'medium', 22050, 'Romanian',     'Mihai'],
            ['tr', 'tr_TR', 'dfki',      'medium', 22050, 'Turkish',      'DFKI'],
            ['el', 'el_GR', 'rapunzelina', 'low',  16000, 'Greek',        'Rapunzelina'],
            ['ka', 'ka_GE', 'natia',     'medium', 22050, 'Georgian',     'Natia'],
            ['zh', 'zh_CN', 'huayan',    'medium', 22050, 'Chinese',      'Huayan'],
        ];

        $rows = [];
        foreach ($entries as $row) {
            [$lang, $locale, $name, $quality, $rate, $langLabel, $voiceLabel] = $row;
            $voiceId = sprintf('%s-%s-%s', $locale, $name, $quality);
            $rows[] = [
                'voice_id'       => $voiceId,
                'language'       => str_replace('_', '-', strtolower($locale)),
                'language_label' => $langLabel,
                'voice_name'     => $voiceLabel,
                'quality'        => $quality,
                'sample_rate'    => $rate,
                'model_url'      => self::buildUrl($lang, $locale, $name, $quality, $voiceId, '.onnx'),
                'config_url'     => self::buildUrl($lang, $locale, $name, $quality, $voiceId, '.onnx.json'),
            ];
        }
        return $rows;
    }

    /**
     * @param array<int, array<string, mixed>> $rows
     * @return array<int, array<string, mixed>>
     */
    private static function sortRows(array $rows): array
    {
        usort($rows, static fn(array $a, array $b): int =>
            strcmp($a['language'] . $a['voice_name'], $b['language'] . $b['voice_name'])
        );
        return $rows;
    }

    public static function buildUrl(
        string $lang,
        string $locale,
        string $name,
        string $quality,
        string $voiceId,
        string $extension
    ): string {
        return sprintf(
            '%s/%s/%s/%s/%s/%s%s',
            self::HUGGINGFACE_BASE,
            rawurlencode($lang),
            rawurlencode($locale),
            rawurlencode($name),
            rawurlencode($quality),
            rawurlencode($voiceId),
            $extension
        );
    }
}
