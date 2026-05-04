<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Engine\Actions;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\Engines\PiperEngine;
use Modules\ModulePhraseStudio\Lib\PhraseStudioMain;

/**
 * Downloads the architecture-matched Piper tarball, extracts it
 * and verifies that the resulting binary is runnable.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Engine\Actions
 */
class InstallEngineAction
{
    public static function main(array $data): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;

        (new PhraseStudioMain())->ensureStorageLayout();

        $engine = new PiperEngine();
        if ($engine->isInstalled()) {
            $res->success  = true;
            $res->httpCode = 200;
            $res->data = [
                'engine'    => $engine->getId(),
                'installed' => true,
                'version'   => $engine->getVersion(),
                'message'   => 'Engine already installed',
            ];
            return $res;
        }

        $result = $engine->install();
        $res->success  = (bool)($result['success'] ?? false);
        $res->httpCode = $res->success ? 200 : 500;
        $res->data = [
            'engine'    => $engine->getId(),
            'installed' => $engine->isInstalled(),
            'version'   => $result['version'] ?? '',
            'message'   => (string)($result['message'] ?? ''),
        ];

        if (!$res->success) {
            $res->messages['error'][] = (string)($result['message'] ?? 'Engine install failed');
        }
        return $res;
    }
}
