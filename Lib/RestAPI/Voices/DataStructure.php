<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Voices;

use MikoPBX\PBXCoreREST\Lib\Common\AbstractDataStructure;
use MikoPBX\PBXCoreREST\Lib\Common\OpenApiSchemaProvider;

/**
 * Schema definitions for the Voices resource.
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Voices
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
                'voice_id' => [
                    'type'        => 'string',
                    'description' => 'rest_param_phrase_studio_voice_id',
                    'minLength'   => 1,
                    'maxLength'   => 255,
                    'example'     => 'ru_RU-irina-medium',
                ],
                'language' => [
                    'type'        => 'string',
                    'description' => 'rest_param_phrase_studio_language',
                    'maxLength'   => 16,
                    'example'     => 'ru-ru',
                ],
                'installed_only' => [
                    'type'        => 'boolean',
                    'description' => 'rest_param_phrase_studio_installed_only',
                    'default'     => false,
                    'example'     => true,
                ],
            ],
            'response' => [
                'voice_name' => [
                    'type'        => 'string',
                    'description' => 'rest_schema_phrase_studio_voice_name',
                    'readOnly'    => true,
                    'example'     => 'Irina',
                ],
                'quality' => [
                    'type'        => 'string',
                    'description' => 'rest_schema_phrase_studio_voice_quality',
                    'enum'        => ['x_low', 'low', 'medium', 'high'],
                    'readOnly'    => true,
                    'example'     => 'medium',
                ],
                'sample_rate' => [
                    'type'        => 'integer',
                    'description' => 'rest_schema_phrase_studio_voice_sample_rate',
                    'readOnly'    => true,
                    'example'     => 22050,
                ],
                'installed' => [
                    'type'        => 'boolean',
                    'description' => 'rest_schema_phrase_studio_voice_installed',
                    'readOnly'    => true,
                    'example'     => false,
                ],
                'size_bytes' => [
                    'type'        => 'integer',
                    'description' => 'rest_schema_phrase_studio_voice_size_bytes',
                    'readOnly'    => true,
                    'example'     => 60291482,
                ],
            ],
            'related' => [],
        ];
    }
}
