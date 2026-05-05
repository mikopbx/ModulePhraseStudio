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
 * Accepts an optional `force` flag in the request body. Without it, an
 * already-installed engine is reported as "Engine already installed"
 * without touching the disk — the standard idempotent install path.
 * With `force=true` (used by the "Update engine" UI button) the engine
 * is re-downloaded even when a working binary is already present, so
 * the same endpoint doubles as a refresh path for picking up new
 * `RELEASE_VERSION` pins or repairing a corrupted install.
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

        $force = filter_var($data['force'] ?? false, FILTER_VALIDATE_BOOLEAN);

        $engine = new PiperEngine();
        if (!$force && $engine->isInstalled()) {
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

        // PiperEngine::install() always uses staged extraction internally,
        // so it handles both fresh-install and update without a force flag.
        // The action layer is the only place where `force` matters: it
        // gates whether we even call install() when isInstalled() is true.
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
