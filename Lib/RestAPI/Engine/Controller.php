<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Engine;

use MikoPBX\PBXCoreREST\Attributes\{
    ApiResource,
    ApiOperation,
    ApiResponse,
    HttpMapping,
    ResourceSecurity,
    SecurityType
};
use MikoPBX\PBXCoreREST\Controllers\BaseRestController;

/**
 * REST controller for the Piper engine binary lifecycle.
 *
 * GET    /pbxcore/api/v3/module-phrase-studio/engine             status
 * POST   /pbxcore/api/v3/module-phrase-studio/engine:install     download + extract
 * DELETE /pbxcore/api/v3/module-phrase-studio/engine             remove binary
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Engine
 */
#[ApiResource(
    path: '/pbxcore/api/v3/module-phrase-studio/engine',
    tags: ['Module Phrase Studio - Engine'],
    description: 'Manage the Piper TTS engine binary on the PBX',
    processor: Processor::class
)]
#[HttpMapping(
    mapping: [
        'GET'    => ['getList'],
        'POST'   => ['install'],
        'DELETE' => ['delete'],
    ],
    resourceLevelMethods: [],
    collectionLevelMethods: ['install'],
    customMethods: ['install'],
    idPattern: null
)]
#[ResourceSecurity('module-phrase-studio-engine', requirements: [SecurityType::LOCALHOST, SecurityType::BEARER_TOKEN])]
class Controller extends BaseRestController
{
    protected string $processorClass = Processor::class;

    /**
     * @route GET /pbxcore/api/v3/module-phrase-studio/engine
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_engine_GetRecord',
        description: 'rest_phrase_studio_engine_GetRecordDesc',
        operationId: 'getPhraseStudioEngineStatus'
    )]
    #[ApiResponse(200, 'rest_response_200_record')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(500, 'rest_response_500')]
    public function getList(): void {}

    /**
     * @route POST /pbxcore/api/v3/module-phrase-studio/engine:install
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_engine_Install',
        description: 'rest_phrase_studio_engine_InstallDesc',
        operationId: 'installPhraseStudioEngine'
    )]
    #[ApiResponse(200, 'rest_response_200_record')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(409, 'rest_response_409')]
    #[ApiResponse(500, 'rest_response_500')]
    public function install(): void {}

    /**
     * @route DELETE /pbxcore/api/v3/module-phrase-studio/engine
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_engine_Delete',
        description: 'rest_phrase_studio_engine_DeleteDesc',
        operationId: 'deletePhraseStudioEngine'
    )]
    #[ApiResponse(200, 'rest_response_200_delete')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(500, 'rest_response_500')]
    public function delete(): void {}
}
