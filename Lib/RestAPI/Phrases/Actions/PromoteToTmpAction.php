<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions;

use MikoPBX\Common\Models\SoundFiles;
use MikoPBX\Core\System\Configs\SoundFilesConf;
use MikoPBX\Core\System\Directories;
use MikoPBX\Core\System\Util;
use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\PhraseStudioMain;
use Modules\ModulePhraseStudio\Models\PhraseStudioPhrases;

/**
 * Stages a cached phrase WAV into MikoPBX's sound files folder and produces
 * Asterisk-compatible derivatives.
 *
 * We deliberately bypass `SoundFilesAPI::convertAudioFile` — that endpoint
 * forces sample_rate=8000/bitrate=16k and a loudnorm pre-pass, which mangles
 * Piper's clean 22 kHz speech into a tinny "talking through a bucket" MP3.
 * Instead, we copy the WAV directly to the target directory and call
 * `SoundFilesConf::convertAudioFile()` with quality-friendly options:
 *   - sample_rate=22050   keeps the WAV at the rate Piper produces
 *   - bitrate=128k        produces a clean MP3 for the browser preview
 *   - normalize=false     Piper already outputs normalised audio
 * The codec-mandated formats (ulaw/alaw/gsm/sln/g722) are still resampled
 * to the rates Asterisk requires, so telephony playback is unaffected.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions
 */
class PromoteToTmpAction
{
    private const array TARGET_FORMATS = ['wav', 'mp3', 'ulaw', 'alaw', 'gsm', 'g722', 'sln'];

    public static function main(array $data): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;

        $id = (int)($data['id'] ?? $data['phrase_id'] ?? 0);
        if ($id <= 0) {
            $res->messages['error'][] = 'phrase id is required';
            $res->httpCode = 400;
            return $res;
        }

        $row = PhraseStudioPhrases::findFirstById($id);
        if ($row === null) {
            $res->messages['error'][] = 'Phrase not found';
            $res->httpCode = 404;
            return $res;
        }

        $filePath = (string)($row->file_path ?? '');
        $real     = $filePath === '' ? false : realpath($filePath);
        $allowed  = realpath(PhraseStudioMain::phrasesDir());

        if ($real === false || $allowed === false || !str_starts_with($real, $allowed . DIRECTORY_SEPARATOR)) {
            $res->messages['error'][] = 'Phrase file is missing or not accessible';
            $res->httpCode = 404;
            return $res;
        }

        $category = strtolower(trim((string)($data['category'] ?? 'custom')));
        $targetDir = self::resolveTargetDir($category);
        if ($targetDir === '') {
            $res->messages['error'][] = 'Invalid category: ' . $category;
            $res->httpCode = 400;
            return $res;
        }
        Util::mwMkdir($targetDir);

        $baseName = self::buildUniqueBaseName($targetDir, (string)($data['name'] ?? ''), $row);
        $targetWav = $targetDir . '/' . $baseName . '.wav';

        if (!@copy($real, $targetWav)) {
            $res->messages['error'][] = 'Failed to stage phrase into sound files directory';
            $res->httpCode = 500;
            return $res;
        }

        $convert = SoundFilesConf::convertAudioFile(
            $targetWav,
            self::TARGET_FORMATS,
            [
                'normalize'   => false,
                'use_cache'   => false,
                'force'       => true,
                'output_dir'  => $targetDir,
                'base_name'   => $baseName,
                'sample_rate' => (int)($row->sample_rate ?? 22050) ?: 22050,
                'bitrate'     => '128k',
            ]
        );

        if (empty($convert['success'])) {
            @unlink($targetWav);
            $res->messages['error'][] = (string)($convert['error'] ?? 'Audio conversion failed');
            $res->httpCode = 500;
            return $res;
        }

        $mp3Path = $convert['formats']['mp3']['path'] ?? null;
        if ($mp3Path === null || !is_file($mp3Path)) {
            $res->messages['error'][] = 'MP3 conversion missing — preview not available';
            $res->httpCode = 500;
            return $res;
        }

        $res->success = true;
        $res->httpCode = 200;
        $res->data = [
            'path'         => $mp3Path,
            'mp3_path'     => $mp3Path,
            'wav_path'     => $targetWav,
            'basename'     => $baseName,
            'category'     => $category,
            'phrase_id'    => (int)$row->id,
        ];
        return $res;
    }

    private static function resolveTargetDir(string $category): string
    {
        return match ($category) {
            SoundFiles::CATEGORY_CUSTOM, 'custom' => Directories::getDir(Directories::AST_CUSTOM_SOUND_DIR),
            SoundFiles::CATEGORY_MOH, 'moh'       => Directories::getDir(Directories::AST_MOH_DIR),
            default => '',
        };
    }

    /**
     * Picks a sanitised, collision-free basename inside the target directory.
     *
     * If the user has not supplied an explicit name, we derive one from the
     * first 120 chars of the phrase text — transliterated to ASCII so a
     * Russian phrase like "Здравствуйте, добрый день" lands on disk as
     * `Zdravstvujte_dobryj_den.wav` instead of an opaque `phrase-12.wav`.
     *
     * Falls back to `phrase-<id>` if the snippet sanitises to nothing,
     * then bumps `_1`, `_2`, … if the slot is already taken.
     */
    private static function buildUniqueBaseName(string $targetDir, string $suggested, PhraseStudioPhrases $row): string
    {
        $base = trim($suggested);
        if ($base === '') {
            $base = self::deriveFromText((string)($row->text ?? ''));
        }
        $base = self::sanitizeBaseName($base);
        if ($base === '') {
            $base = 'phrase-' . (int)$row->id;
        }
        // Trim to leave room for the "_99" suffix and the file extension.
        if (mb_strlen($base) > 120) {
            $base = (string)mb_substr($base, 0, 120);
            $base = trim($base, '_-');
            if ($base === '') {
                $base = 'phrase-' . (int)$row->id;
            }
        }

        $candidate = $base;
        $counter = 1;
        while (self::baseNameTaken($targetDir, $candidate) && $counter < 100) {
            $candidate = $base . '_' . $counter;
            $counter++;
        }
        return $candidate;
    }

    /**
     * Builds a human-readable ASCII slug from the phrase text.
     * Uses ext-intl's Transliterator when present, otherwise falls back to
     * iconv's `//TRANSLIT` mode. Both reduce Cyrillic / accented Latin to
     * plain ASCII letters.
     */
    private static function deriveFromText(string $text): string
    {
        $snippet = (string)mb_substr($text, 0, 200);
        $ascii = '';

        if (class_exists(\Transliterator::class)) {
            $tr = \Transliterator::create('Any-Latin; Latin-ASCII; [:Nonspacing Mark:] Remove; [:Punctuation:] Remove');
            if ($tr !== null) {
                $ascii = (string)$tr->transliterate($snippet);
            }
        }
        if ($ascii === '') {
            $prev = setlocale(LC_CTYPE, 'C.UTF-8', 'C', '0');
            $iconv = @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $snippet);
            if ($prev !== false) {
                setlocale(LC_CTYPE, $prev);
            }
            if ($iconv !== false) {
                $ascii = $iconv;
            }
        }
        if ($ascii === '') {
            $ascii = $snippet;
        }
        return $ascii;
    }

    /**
     * Collapses whitespace and forbidden characters into a single underscore
     * and trims leading / trailing separators.
     */
    private static function sanitizeBaseName(string $value): string
    {
        $value = (string)preg_replace('/\s+/u', '_', $value);
        $value = (string)preg_replace('/[^A-Za-z0-9_\-]+/u', '_', $value);
        $value = (string)preg_replace('/_+/', '_', $value);
        return trim($value, '_-');
    }

    private static function baseNameTaken(string $targetDir, string $base): bool
    {
        foreach (self::TARGET_FORMATS as $format) {
            if (file_exists($targetDir . '/' . $base . '.' . $format)) {
                return true;
            }
        }
        return false;
    }
}
