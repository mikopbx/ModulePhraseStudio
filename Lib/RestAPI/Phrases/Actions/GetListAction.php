<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Models\PhraseStudioPhrases;

/**
 * Returns the list of generated phrases (most recent first).
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions
 */
class GetListAction
{
    public static function main(array $data): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;

        $rows = PhraseStudioPhrases::find([
            'order' => 'created_at DESC',
        ]);

        $list = [];
        foreach ($rows as $row) {
            $list[] = [
                'id'          => (int)$row->id,
                'cache_key'   => (string)$row->cache_key,
                'text'        => (string)$row->text,
                'voice_id'    => (string)$row->voice_id,
                'sample_rate' => (int)$row->sample_rate,
                'duration_ms' => (int)$row->duration_ms,
                'size_bytes'  => (int)$row->size_bytes,
                'created_at'  => (int)$row->created_at,
            ];
        }

        $res->success  = true;
        $res->httpCode = 200;
        $res->data     = $list;
        return $res;
    }
}
