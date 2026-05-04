<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Phrases;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions\DeletePhraseAction;
use Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions\DownloadPhraseAction;
use Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions\GeneratePhraseAction;
use Modules\ModulePhraseStudio\Lib\RestAPI\Phrases\Actions\GetListAction;
use Phalcon\Di\Injectable;

/**
 * Routes Phrases resource requests to Action classes.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Phrases
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
            case 'create':
            case 'generate':
                $res = GeneratePhraseAction::main($request['data'] ?? []);
                break;
            case 'download':
                $res = DownloadPhraseAction::main($request['data'] ?? []);
                break;
            case 'delete':
                $res = DeletePhraseAction::main($request['data'] ?? []);
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
