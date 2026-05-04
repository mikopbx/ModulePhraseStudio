<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Voices;

use MikoPBX\PBXCoreREST\Attributes\{
    ApiResource,
    ApiOperation,
    ApiParameterRef,
    ApiResponse,
    HttpMapping,
    ResourceSecurity,
    SecurityType
};
use MikoPBX\PBXCoreREST\Controllers\BaseRestController;

/**
 * REST controller for voice catalogue + installed voices.
 *
 * GET    /pbxcore/api/v3/module-phrase-studio/voices              catalogue + installed
 * POST   /pbxcore/api/v3/module-phrase-studio/voices:install      download model
 * DELETE /pbxcore/api/v3/module-phrase-studio/voices/{id}         remove model
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Voices
 */
#[ApiResource(
    path: '/pbxcore/api/v3/module-phrase-studio/voices',
    tags: ['Module Phrase Studio - Voices'],
    description: 'Manage Piper voice models on the PBX',
    processor: Processor::class
)]
#[HttpMapping(
    mapping: [
        'GET'    => ['getList'],
        'POST'   => ['install'],
        'DELETE' => ['delete'],
    ],
    resourceLevelMethods: ['delete'],
    collectionLevelMethods: ['getList', 'install'],
    customMethods: ['install'],
    idPattern: '[^/:]+'
)]
#[ResourceSecurity('module-phrase-studio-voices', requirements: [SecurityType::LOCALHOST, SecurityType::BEARER_TOKEN])]
class Controller extends BaseRestController
{
    protected string $processorClass = Processor::class;

    /**
     * @route GET /pbxcore/api/v3/module-phrase-studio/voices
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_voices_GetList',
        description: 'rest_phrase_studio_voices_GetListDesc',
        operationId: 'getPhraseStudioVoicesList'
    )]
    #[ApiParameterRef('language', dataStructure: DataStructure::class, required: false)]
    #[ApiParameterRef('installed_only', dataStructure: DataStructure::class, required: false)]
    #[ApiResponse(200, 'rest_response_200_list')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(500, 'rest_response_500')]
    public function getList(): void {}

    /**
     * @route POST /pbxcore/api/v3/module-phrase-studio/voices:install
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_voices_Install',
        description: 'rest_phrase_studio_voices_InstallDesc',
        operationId: 'installPhraseStudioVoice'
    )]
    #[ApiParameterRef('voice_id', dataStructure: DataStructure::class, required: true)]
    #[ApiResponse(200, 'rest_response_200_record')]
    #[ApiResponse(400, 'rest_response_400')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(404, 'rest_response_404')]
    #[ApiResponse(500, 'rest_response_500')]
    public function install(): void {}

    /**
     * @route DELETE /pbxcore/api/v3/module-phrase-studio/voices/{id}
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_voices_Delete',
        description: 'rest_phrase_studio_voices_DeleteDesc',
        operationId: 'deletePhraseStudioVoice'
    )]
    #[ApiResponse(200, 'rest_response_200_delete')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(404, 'rest_response_404')]
    #[ApiResponse(500, 'rest_response_500')]
    public function delete(): void {}
}
