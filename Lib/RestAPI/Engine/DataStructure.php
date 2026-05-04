<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Engine;

use MikoPBX\PBXCoreREST\Lib\Common\AbstractDataStructure;
use MikoPBX\PBXCoreREST\Lib\Common\OpenApiSchemaProvider;

/**
 * Schema definitions for the Engine resource (status payload).
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Engine
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
            'request' => [],
            'response' => [
                'engine' => [
                    'type'        => 'string',
                    'description' => 'rest_schema_phrase_studio_engine_id',
                    'readOnly'    => true,
                    'example'     => 'piper',
                ],
                'installed' => [
                    'type'        => 'boolean',
                    'description' => 'rest_schema_phrase_studio_engine_installed',
                    'readOnly'    => true,
                    'example'     => true,
                ],
                'version' => [
                    'type'        => 'string',
                    'description' => 'rest_schema_phrase_studio_engine_version',
                    'readOnly'    => true,
                    'example'     => '1.2.0',
                ],
                'binary_path' => [
                    'type'        => 'string',
                    'description' => 'rest_schema_phrase_studio_engine_binary_path',
                    'readOnly'    => true,
                    'example'     => '/storage/usbdisk1/mikopbx/modules/ModulePhraseStudio/db/piper/piper/piper',
                ],
            ],
            'related' => [],
        ];
    }
}
