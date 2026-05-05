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
 * Asterisk-compatible derivatives (wav/mp3/ulaw/alaw/gsm/g722/sln).
 *
 * Runs synchronously inside `WorkerApiCommands` — ffmpeg fan-out for 7
 * formats finishes in ~1–2 s on a healthy box, well inside the 30-second
 * sync-timeout. Splits into a pre-flight `main()` and a static helper
 * `executePromotion()` only for clarity (one validates request inputs,
 * the other runs the conversion); both share the same request thread.
 *
 * Quality knobs (overrides core defaults of 8 kHz / 16k bitrate / loudnorm):
 *   - sample_rate=22050 keeps WAV at Piper's native rate
 *   - bitrate=128k preserves clean preview-MP3
 *   - normalize=false — Piper output is already normalised
 * Codec-specific formats (ulaw/alaw/gsm/sln/g722) are still resampled to the
 * rates Asterisk requires for telephony playback.
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

        $baseName  = self::buildUniqueBaseName($targetDir, (string)($data['name'] ?? ''), $row);
        $sampleRate = (int)($row->sample_rate ?? 22050) ?: 22050;

        // ffmpeg fan-out runs synchronously here — 1–2 s for the seven
        // codec targets fits comfortably inside WorkerApiCommands' 30-second
        // sync budget, no detach needed.
        $result = self::executePromotion([
            'source'      => $real,
            'target_dir'  => $targetDir,
            'base_name'   => $baseName,
            'sample_rate' => $sampleRate,
            'category'    => $category,
            'phrase_id'   => (int)$row->id,
        ]);

        if (empty($result['success'])) {
            $res->messages['error'][] = (string)($result['message'] ?? 'Audio conversion failed');
            $res->httpCode = 500;
            return $res;
        }

        $res->success  = true;
        $res->httpCode = 200;
        $res->data = [
            'path'      => (string)($result['mp3_path'] ?? ''),
            'mp3_path'  => (string)($result['mp3_path'] ?? ''),
            'wav_path'  => (string)($result['wav_path'] ?? ''),
            'basename'  => $baseName,
            'category'  => $category,
            'phrase_id' => (int)$row->id,
        ];
        return $res;
    }

    /**
     * The actual ffmpeg fan-out. Pure helper — accepts a fully resolved
     * payload and runs SoundFilesConf::convertAudioFile().
     *
     * Critical: `$payload['source']` MUST point at the original cached WAV
     * in `db/phrases/`, NOT at the future `$baseName.wav` in the target dir.
     * convertAudioFile would otherwise read and write the same file for the
     * 'wav' target, and ffmpeg fails with exit 234 ("input/output is same
     * file"). Keeping the source separate from output_dir avoids the trap.
     *
     * @param array{source: string, target_dir: string, base_name: string, sample_rate: int, category: string, phrase_id: int} $payload
     * @return array{success: bool, message?: string, mp3_path?: string, wav_path?: string, basename?: string, category?: string, phrase_id?: int}
     */
    private static function executePromotion(array $payload): array
    {
        $source     = (string)($payload['source'] ?? '');
        $targetDir  = (string)($payload['target_dir'] ?? '');
        $baseName   = (string)($payload['base_name'] ?? '');
        $sampleRate = (int)($payload['sample_rate'] ?? 22050) ?: 22050;

        if ($source === '' || !is_file($source)) {
            return ['success' => false, 'message' => 'Source phrase WAV is missing'];
        }
        if ($targetDir === '' || $baseName === '') {
            return ['success' => false, 'message' => 'Target directory or basename missing'];
        }

        Util::mwMkdir($targetDir);

        $convert = SoundFilesConf::convertAudioFile(
            $source,
            self::TARGET_FORMATS,
            [
                'normalize'   => false,
                'use_cache'   => false,
                'force'       => true,
                'output_dir'  => $targetDir,
                'base_name'   => $baseName,
                'sample_rate' => $sampleRate,
                'bitrate'     => '128k',
            ]
        );

        if (empty($convert['success'])) {
            $error = (string)($convert['error'] ?? '');
            if ($error === '') {
                foreach ((array)($convert['formats'] ?? []) as $fmt => $info) {
                    if (($info['status'] ?? '') === 'failed' && !empty($info['error'])) {
                        $error = "$fmt: " . (string)$info['error'];
                        break;
                    }
                }
            }
            // Roll back: drop any partial output so a retry starts clean.
            foreach (self::TARGET_FORMATS as $fmt) {
                @unlink($targetDir . '/' . $baseName . '.' . $fmt);
            }
            return [
                'success' => false,
                'message' => $error !== '' ? $error : 'Audio conversion failed',
            ];
        }

        $mp3Path = $convert['formats']['mp3']['path'] ?? null;
        if ($mp3Path === null || !is_file($mp3Path)) {
            return [
                'success' => false,
                'message' => 'MP3 conversion missing — preview not available',
            ];
        }

        return [
            'success'   => true,
            'mp3_path'  => (string)$mp3Path,
            'wav_path'  => $targetDir . '/' . $baseName . '.wav',
            'basename'  => $baseName,
            'category'  => (string)($payload['category'] ?? ''),
            'phrase_id' => (int)($payload['phrase_id'] ?? 0),
        ];
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
     * first 200 chars of the phrase text — transliterated to ASCII so a
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
