<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Phrases;

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
 * REST controller for phrase generation + history.
 *
 * GET    /pbxcore/api/v3/module-phrase-studio/phrases                 history list
 * POST   /pbxcore/api/v3/module-phrase-studio/phrases                 generate phrase
 * GET    /pbxcore/api/v3/module-phrase-studio/phrases/{id}:download   download wav
 * DELETE /pbxcore/api/v3/module-phrase-studio/phrases/{id}            delete phrase
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Phrases
 */
#[ApiResource(
    path: '/pbxcore/api/v3/module-phrase-studio/phrases',
    tags: ['Module Phrase Studio - Phrases'],
    description: 'Generate and manage TTS phrases',
    processor: Processor::class
)]
#[HttpMapping(
    mapping: [
        'GET'    => ['getList', 'download'],
        'HEAD'   => ['download'],
        'POST'   => ['create', 'promoteToTmp'],
        'DELETE' => ['delete'],
    ],
    resourceLevelMethods: ['download', 'delete', 'promoteToTmp'],
    collectionLevelMethods: ['getList', 'create'],
    customMethods: ['download', 'promoteToTmp'],
    idPattern: '[^/:]+'
)]
#[ResourceSecurity('module-phrase-studio-phrases', requirements: [SecurityType::LOCALHOST, SecurityType::BEARER_TOKEN])]
class Controller extends BaseRestController
{
    protected string $processorClass = Processor::class;

    /**
     * @route GET /pbxcore/api/v3/module-phrase-studio/phrases
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_phrases_GetList',
        description: 'rest_phrase_studio_phrases_GetListDesc',
        operationId: 'getPhraseStudioPhrasesList'
    )]
    #[ApiResponse(200, 'rest_response_200_list')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(500, 'rest_response_500')]
    public function getList(): void {}

    /**
     * @route POST /pbxcore/api/v3/module-phrase-studio/phrases
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_phrases_Generate',
        description: 'rest_phrase_studio_phrases_GenerateDesc',
        operationId: 'generatePhraseStudioPhrase'
    )]
    #[ApiParameterRef('text',        dataStructure: DataStructure::class, required: true)]
    #[ApiParameterRef('voice_id',    dataStructure: DataStructure::class, required: true)]
    #[ApiParameterRef('sample_rate', dataStructure: DataStructure::class, required: false)]
    #[ApiResponse(200, 'rest_response_200_record')]
    #[ApiResponse(400, 'rest_response_400')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(409, 'rest_response_409')]
    #[ApiResponse(500, 'rest_response_500')]
    public function generate(): void {}

    /**
     * @route GET /pbxcore/api/v3/module-phrase-studio/phrases/{id}:download
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_phrases_Download',
        description: 'rest_phrase_studio_phrases_DownloadDesc',
        operationId: 'downloadPhraseStudioPhrase'
    )]
    #[ApiResponse(200, 'rest_response_200_file_download')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(404, 'rest_response_404')]
    #[ApiResponse(500, 'rest_response_500')]
    public function download(): void {}

    /**
     * @route POST /pbxcore/api/v3/module-phrase-studio/phrases/{id}:promoteToTmp
     *
     * Stages a generated phrase WAV into MikoPBX's tmp/uploads directory so the
     * core SoundFiles converter can pick it up. Used by the SoundFiles modify
     * page integration (see Lib/PhraseStudioConf::onAfterAssetsPrepared).
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_phrases_PromoteToTmp',
        description: 'rest_phrase_studio_phrases_PromoteToTmpDesc',
        operationId: 'promotePhraseStudioPhraseToTmp'
    )]
    #[ApiResponse(200, 'rest_response_200_record')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(404, 'rest_response_404')]
    #[ApiResponse(500, 'rest_response_500')]
    public function promoteToTmp(): void {}

    /**
     * @route DELETE /pbxcore/api/v3/module-phrase-studio/phrases/{id}
     */
    #[ApiOperation(
        summary: 'rest_phrase_studio_phrases_Delete',
        description: 'rest_phrase_studio_phrases_DeleteDesc',
        operationId: 'deletePhraseStudioPhrase'
    )]
    #[ApiResponse(200, 'rest_response_200_delete')]
    #[ApiResponse(401, 'rest_response_401')]
    #[ApiResponse(404, 'rest_response_404')]
    #[ApiResponse(500, 'rest_response_500')]
    public function delete(): void {}
}
