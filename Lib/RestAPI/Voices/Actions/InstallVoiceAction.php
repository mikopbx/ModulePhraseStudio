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
 * Queues an asynchronous voice download.
 *
 * Voice models are 30–60 MB. The actual curl runs longer than the
 * 30-second `WorkerApiCommands` sync-timeout, so a synchronous handler
 * would always reply "timed out" to the browser while the download
 * keeps churning in the background — exactly the UX bug the user hit
 * ("loader disappears immediately, model installs after some time").
 *
 * The flow now:
 *   1. REST creates a placeholder row with `install_status='installing'`
 *      and publishes a job to WorkerPhraseStudio (publish, not sendRequest
 *      — we don't wait).
 *   2. REST returns 202 immediately.
 *   3. The worker downloads the .onnx files and flips the row to
 *      `'installed'` (or `'failed'` with `install_error`).
 *   4. The UI polls `GET /voices` every 3 s and updates the loader/state
 *      from `install_status`.
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

        if (empty($result['success'])) {
            $res->messages['error'][] = (string)($result['message'] ?? 'Voice install failed to queue');
            $res->httpCode = 400;
            return $res;
        }

        $res->success  = true;
        // 202 Accepted: download is in progress, client should poll GET /voices
        // and watch the row's `install_status` field for completion.
        $res->httpCode = 202;
        $res->data = [
            'voice_id'       => (string)($result['voice_id'] ?? $voiceId),
            'install_status' => 'installing',
            'queued'         => (bool)($result['queued'] ?? true),
            'message'        => (string)($result['message'] ?? 'Install queued'),
        ];
        return $res;
    }
}
