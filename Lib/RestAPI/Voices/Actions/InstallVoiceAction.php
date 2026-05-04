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
 * Downloads a voice model (.onnx + .onnx.json) and registers it.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Voices\Actions
 */
class InstallVoiceAction
{
    public static function main(array $data): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;

        $voiceId = trim((string)($data['voice_id'] ?? ''));
        if ($voiceId === '') {
            $res->messages['error'][] = 'voice_id is required';
            $res->httpCode = 400;
            return $res;
        }

        $main   = new PhraseStudioMain();
        $result = $main->installVoice($voiceId);

        $res->success  = (bool)($result['success'] ?? false);
        $res->httpCode = $res->success ? 200 : 500;
        $res->data = [
            'voice_id'  => $result['voice_id'] ?? $voiceId,
            'installed' => $res->success,
            'message'   => (string)($result['message'] ?? ''),
        ];

        if (!$res->success) {
            $res->messages['error'][] = (string)($result['message'] ?? 'Voice install failed');
        }
        return $res;
    }
}
