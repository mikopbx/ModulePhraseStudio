<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Voices;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\RestAPI\Voices\Actions\DeleteVoiceAction;
use Modules\ModulePhraseStudio\Lib\RestAPI\Voices\Actions\GetListAction;
use Modules\ModulePhraseStudio\Lib\RestAPI\Voices\Actions\InstallVoiceAction;
use Phalcon\Di\Injectable;

/**
 * Routes Voices resource requests to Action classes.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Voices
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
                $res = GetListAction::main($request['data'] ?? []);
                break;
            case 'install':
                $res = InstallVoiceAction::main($request['data'] ?? []);
                break;
            case 'delete':
                $res = DeleteVoiceAction::main($request['data'] ?? []);
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
