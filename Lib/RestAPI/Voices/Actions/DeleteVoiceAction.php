<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Voices\Actions;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\PhraseStudioMain;

/**
 * Removes a previously installed voice model from disk and from
 * m_ModulePhraseStudio_Voices.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Voices\Actions
 */
class DeleteVoiceAction
{
    public static function main(array $data): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;

        // Resource-level routes pass the URL segment as `id`. The voice
        // resource is keyed by voice_id, so we accept both for clarity.
        $voiceId = trim((string)($data['voice_id'] ?? $data['id'] ?? ''));
        if ($voiceId === '') {
            $res->messages['error'][] = 'voice_id is required';
            $res->httpCode = 400;
            return $res;
        }

        $main = new PhraseStudioMain();
        $result = $main->uninstallVoice($voiceId);

        $res->success  = (bool)($result['success'] ?? false);
        $res->httpCode = $res->success ? 200 : 404;
        $res->data = [
            'voice_id' => $voiceId,
            'message'  => (string)($result['message'] ?? ''),
        ];
        if (!$res->success) {
            $res->messages['error'][] = (string)($result['message'] ?? 'Voice delete failed');
        }
        return $res;
    }
}
