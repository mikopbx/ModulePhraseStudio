<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Engine;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\RestAPI\Engine\Actions\EngineStatusAction;
use Modules\ModulePhraseStudio\Lib\RestAPI\Engine\Actions\InstallEngineAction;
use Modules\ModulePhraseStudio\Lib\RestAPI\Engine\Actions\UninstallEngineAction;
use Phalcon\Di\Injectable;

/**
 * Routes Engine resource requests to the matching Action class.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Engine
 */
class Processor extends Injectable
{
    public static function callBack(array $request): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;
        $action = $request['action'] ?? '';

        switch ($action) {
            case 'getList':
                $res = EngineStatusAction::main($request['data'] ?? []);
                break;
            case 'install':
                $res = InstallEngineAction::main($request['data'] ?? []);
                break;
            case 'delete':
                $res = UninstallEngineAction::main($request['data'] ?? []);
                break;
            default:
                $res->messages['error'][] = 'Unknown action - ' . (string)$action . ' in ' . __CLASS__;
                $res->httpCode = 400;
                break;
        }

        $res->function = $action;
        return $res;
    }
}
