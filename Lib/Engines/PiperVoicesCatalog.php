<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\Engines;

/**
 * Static catalogue of Piper voices that can be downloaded on demand.
 *
 * Voice models live on Hugging Face under
 *   https://huggingface.co/rhasspy/piper-voices/resolve/main/{lang}/{lang_code}/{name}/{quality}/{voice_id}.onnx
 *
 * For a first cut we ship a curated subset that covers the languages
 * MikoPBX already supports through its language packs. The catalogue
 * is intentionally hand-maintained so that the UI does not have to
 * call out to Hugging Face just to render the voice list.
 *
 * @package Modules\ModulePhraseStudio\Lib\Engines
 */
final class PiperVoicesCatalog
{
    private const HUGGINGFACE_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main';

    /**
     * @return array<int, array<string, mixed>> Voice catalogue entries, sorted by language.
     */
    public static function all(): array
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
            ['el', 'el_GR', 'rapunzel',  'low',    16000, 'Greek',        'Rapunzel'],
            ['ka', 'ka_GE', 'natia',     'medium', 22050, 'Georgian',     'Natia'],
            ['zh', 'zh_CN', 'huayan',    'medium', 22050, 'Chinese',      'Huayan'],
        ];

        $catalog = [];
        foreach ($entries as $row) {
            [$lang, $locale, $name, $quality, $rate, $langLabel, $voiceLabel] = $row;
            $voiceId = sprintf('%s-%s-%s', $locale, $name, $quality);
            $catalog[] = [
                'voice_id'        => $voiceId,
                'language'        => str_replace('_', '-', strtolower($locale)),
                'language_label'  => $langLabel,
                'voice_name'      => $voiceLabel,
                'quality'         => $quality,
                'sample_rate'     => $rate,
                'model_url'       => self::buildUrl($lang, $locale, $name, $quality, $voiceId, '.onnx'),
                'config_url'      => self::buildUrl($lang, $locale, $name, $quality, $voiceId, '.onnx.json'),
            ];
        }

        usort($catalog, static fn(array $a, array $b): int =>
            strcmp($a['language'] . $a['voice_name'], $b['language'] . $b['voice_name'])
        );

        return $catalog;
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

    private static function buildUrl(
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
