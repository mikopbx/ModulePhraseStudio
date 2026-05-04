<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\PhraseStudioMain;

/**
 * Deletes a phrase row from history (DB) and removes its .wav file.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions
 */
class DeletePhraseAction
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

        $main   = new PhraseStudioMain();
        $result = $main->deletePhrase($id);

        $res->success  = (bool)($result['success'] ?? false);
        $res->httpCode = $res->success ? 200 : 404;
        $res->data = [
            'id'      => $id,
            'message' => (string)($result['message'] ?? ''),
        ];

        if (!$res->success) {
            $res->messages['error'][] = (string)($result['message'] ?? 'Delete failed');
        }
        return $res;
    }
}
