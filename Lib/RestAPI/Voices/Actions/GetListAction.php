<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib\RestAPI\Voices\Actions;

use MikoPBX\PBXCoreREST\Lib\PBXApiResult;
use Modules\ModulePhraseStudio\Lib\Engines\PiperVoicesCatalog;
use Modules\ModulePhraseStudio\Models\PhraseStudioVoices;

/**
 * Returns the merged list of catalogue voices + installation status.
 *
 * Each row in the response carries an "installed" flag and, when
 * installed, a "size_bytes" / "installed_at" pair so the UI can
 * show a Delete button without a follow-up call.
 *
 * Optional query parameters:
 *   - language        e.g. "ru-ru" — filter by exact language tag
 *   - installed_only  "1" / "true" — only return installed voices
 *
 * @package Modules\ModulePhraseStudio\Lib\RestAPI\Voices\Actions
 */
class GetListAction
{
    public static function main(array $data): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;

        $installed = self::loadInstalledIndex();

        $languageFilter   = strtolower(trim((string)($data['language'] ?? '')));
        $installedOnlyRaw = strtolower((string)($data['installed_only'] ?? '0'));
        $installedOnly    = in_array($installedOnlyRaw, ['1', 'true', 'yes', 'on'], true);

        $rows = [];
        foreach (PiperVoicesCatalog::all() as $voice) {
            if ($languageFilter !== '' && $voice['language'] !== $languageFilter) {
                continue;
            }
            $isInstalled = isset($installed[$voice['voice_id']]);
            if ($installedOnly && !$isInstalled) {
                continue;
            }
            $rows[] = self::shapeRow($voice, $installed[$voice['voice_id']] ?? null);
        }

        $res->success  = true;
        $res->httpCode = 200;
        $res->data     = $rows;
        return $res;
    }

    /**
     * @return array<string, PhraseStudioVoices>
     */
    private static function loadInstalledIndex(): array
    {
        $index = [];
        foreach (PhraseStudioVoices::find() as $row) {
            $index[(string)$row->voice_id] = $row;
        }
        return $index;
    }

    /**
     * @param array<string, mixed> $voice
     * @param PhraseStudioVoices|null $installed
     * @return array<string, mixed>
     */
    private static function shapeRow(array $voice, ?PhraseStudioVoices $installed): array
    {
        return [
            'voice_id'       => (string)$voice['voice_id'],
            'language'       => (string)$voice['language'],
            'language_label' => (string)$voice['language_label'],
            'voice_name'     => (string)$voice['voice_name'],
            'quality'        => (string)$voice['quality'],
            'sample_rate'    => (int)$voice['sample_rate'],
            'installed'      => $installed !== null,
            'size_bytes'     => (int)($installed->size_bytes ?? 0),
            'installed_at'   => (int)($installed->installed_at ?? 0),
        ];
    }
}
