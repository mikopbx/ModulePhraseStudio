<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\Engines\PiperEngine;
use Modules\ModulePhraseStudio\Lib\PhraseStudioMain;

/**
 * Generates (or returns a cached) phrase audio file.
 *
 * Validation phases:
 *  1. text non-empty + length <= max_text_length
 *  2. voice_id present
 *  3. engine binary installed
 *  4. voice model installed (checked inside PhraseStudioMain::generatePhrase)
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions
 */
class GeneratePhraseAction
{
    public static function main(array $data): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;

        $text       = (string)($data['text'] ?? '');
        $voiceId    = trim((string)($data['voice_id'] ?? ''));
        $sampleRate = (string)($data['sample_rate'] ?? 'native');

        if (trim($text) === '') {
            $res->messages['error'][] = 'text is required';
            $res->httpCode = 400;
            return $res;
        }
        if ($voiceId === '') {
            $res->messages['error'][] = 'voice_id is required';
            $res->httpCode = 400;
            return $res;
        }

        $engine = new PiperEngine();
        if (!$engine->isInstalled()) {
            $res->messages['error'][] = 'Engine is not installed';
            $res->httpCode = 409;
            return $res;
        }

        $main   = new PhraseStudioMain();
        $result = $main->generatePhrase($text, $voiceId, $sampleRate);

        $res->success  = (bool)($result['success'] ?? false);
        $res->httpCode = $res->success ? 200 : 500;
        $res->data = [
            'phrase_id'  => (int)($result['phrase_id'] ?? 0),
            'cache_key'  => (string)($result['cache_key'] ?? ''),
            'cached'     => (bool)($result['cached'] ?? false),
            'voice_id'   => $voiceId,
            'sample_rate'=> $sampleRate,
            'message'    => (string)($result['message'] ?? ''),
        ];

        if (!$res->success) {
            $res->messages['error'][] = (string)($result['message'] ?? 'Generation failed');
        }
        return $res;
    }
}
