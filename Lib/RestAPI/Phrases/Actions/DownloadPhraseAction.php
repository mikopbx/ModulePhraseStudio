<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\PhraseStudioMain;
use Modules\ModulePhraseStudio\Models\PhraseStudioPhrases;

/**
 * Streams a generated phrase .wav back to the caller.
 *
 * Uses BaseController's fpassthru helper for memory-friendly transfer.
 * Defends against directory traversal by:
 *   1. Resolving the model row by primary key (no path coming from query).
 *   2. Verifying realpath() of file_path stays within phrasesDir().
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions
 */
class DownloadPhraseAction
{
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

        $downloadName = sprintf('phrase_%d.wav', $id);
        $size         = (int)@filesize($real);

        $res->success = true;
        $res->data = [
            'fpassthru' => [
                'filename'           => $real,
                'content_type'       => 'audio/wav',
                'download_name'      => $downloadName,
                'need_delete'        => false,
                'additional_headers' => $size > 0 ? ['Content-Length' => (string)$size] : [],
            ],
        ];
        return $res;
    }
}
