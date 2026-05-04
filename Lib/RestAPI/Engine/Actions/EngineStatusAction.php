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
 * Returns the engine binary status: installed?, version, binary path.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Engine\Actions
 */
class EngineStatusAction
{
    public static function main(array $data): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;

        $engine = new PiperEngine();
        $res->success = true;
        $res->data = [
            'engine'      => $engine->getId(),
            'installed'   => $engine->isInstalled(),
            'version'     => $engine->getVersion(),
            'binary_path' => $engine->getBinaryPath(),
        ];
        $res->httpCode = 200;
        return $res;
    }
}
