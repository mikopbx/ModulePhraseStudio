<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Engine\Actions;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\Engines\PiperEngine;

/**
 * Removes the Piper engine binary from disk.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Engine\Actions
 */
class UninstallEngineAction
{
    public static function main(array $data): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;

        $engine = new PiperEngine();
        $result = $engine->uninstall();

        $res->success  = (bool)($result['success'] ?? false);
        $res->httpCode = $res->success ? 200 : 500;
        $res->data = [
            'engine'    => $engine->getId(),
            'installed' => $engine->isInstalled(),
            'message'   => (string)($result['message'] ?? ''),
        ];
        if (!$res->success) {
            $res->messages['error'][] = (string)($result['message'] ?? 'Engine uninstall failed');
        }
        return $res;
    }
}
