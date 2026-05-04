<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Phrases;

use MikoPBX\PBXCoreREST\Lib\Common\AbstractDataStructure;
use MikoPBX\PBXCoreREST\Lib\Common\OpenApiSchemaProvider;

/**
 * Schema definitions for the Phrases resource.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Phrases
 */
class DataStructure extends AbstractDataStructure implements OpenApiSchemaProvider
{
    public static function getListItemSchema(): array
    {
        return self::getDetailSchema();
    }

    public static function getDetailSchema(): array
    {
        $definitions = self::getParameterDefinitions();
        return [
            'type'       => 'object',
            'properties' => array_merge(
                $definitions['request'] ?? [],
                $definitions['response'] ?? []
            ),
        ];
    }

    public static function getRelatedSchemas(): array
    {
        return [];
    }

    public static function getParameterDefinitions(): array
    {
        return [
            'request' => [
                'text' => [
                    'type'        => 'string',
                    'description' => 'rest_param_phrase_studio_text',
                    'minLength'   => 1,
                    'maxLength'   => 2000,
                    'required'    => true,
                    'example'     => 'Здравствуйте, вы позвонили в компанию МИКО.',
                ],
                'voice_id' => [
                    'type'        => 'string',
                    'description' => 'rest_param_phrase_studio_voice_id',
                    'minLength'   => 1,
                    'maxLength'   => 255,
                    'required'    => true,
                    'example'     => 'ru_RU-irina-medium',
                ],
                'sample_rate' => [
                    'type'        => 'string',
                    'description' => 'rest_param_phrase_studio_sample_rate',
                    'enum'        => ['native', 'telephony', '8000', '22050'],
                    'default'     => 'native',
                    'example'     => 'telephony',
                ],
            ],
            'response' => [
                'phrase_id' => [
                    'type'        => 'integer',
                    'description' => 'rest_schema_phrase_studio_phrase_id',
                    'readOnly'    => true,
                    'example'     => 42,
                ],
                'cache_key' => [
                    'type'        => 'string',
                    'description' => 'rest_schema_phrase_studio_cache_key',
                    'readOnly'    => true,
                    'example'     => 'd41d8cd98f00b204e9800998ecf8427e',
                ],
                'cached' => [
                    'type'        => 'boolean',
                    'description' => 'rest_schema_phrase_studio_cached',
                    'readOnly'    => true,
                    'example'     => false,
                ],
                'duration_ms' => [
                    'type'        => 'integer',
                    'description' => 'rest_schema_phrase_studio_duration_ms',
                    'readOnly'    => true,
                    'example'     => 3500,
                ],
                'size_bytes' => [
                    'type'        => 'integer',
                    'description' => 'rest_schema_phrase_studio_phrase_size_bytes',
                    'readOnly'    => true,
                    'example'     => 78404,
                ],
                'created_at' => [
                    'type'        => 'integer',
                    'description' => 'rest_schema_phrase_studio_created_at',
                    'readOnly'    => true,
                    'example'     => 1714502400,
                ],
            ],
            'related' => [],
        ];
    }
}
