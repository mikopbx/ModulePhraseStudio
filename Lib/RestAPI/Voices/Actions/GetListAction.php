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
    /**
     * Stuck-install recovery threshold (seconds).
     *
     * The detached `install-voice.php` runner can die before it has a chance
     * to mark the row 'failed' (OOM, php fatal, kill -9, host reboot). Without
     * a sweeper, the row stays 'installing' forever and the UI shows a
     * disabled spinner the user can't recover from. We treat any 'installing'
     * row whose `install_started_at` is older than this threshold as failed
     * and persist the flip — so subsequent reads stay consistent and the
     * existing Retry / Remove buttons become available.
     *
     * The threshold is intentionally larger than the JS poll cap (~10 min)
     * but well shorter than "never": curl --max-time 600 × 2 = 20 min hard
     * upper bound for a healthy slow install, so 30 min leaves slack without
     * keeping orphans visible all day.
     */
    private const int STALE_INSTALL_THRESHOLD = 30 * 60;

    public static function main(array $data): PBXApiResult
    {
        $res = new PBXApiResult();
        $res->processor = __METHOD__;

        $installed = self::loadInstalledIndex();
        // Side effect: rows whose detached installer died silently are
        // mutated to 'failed' before we shape them, so the UI sees a
        // retryable row instead of a perpetual spinner.
        self::sweepStaleInstalls($installed);

        $languageFilter   = strtolower(trim((string)($data['language'] ?? '')));
        $installedOnlyRaw = strtolower((string)($data['installed_only'] ?? '0'));
        $installedOnly    = in_array($installedOnlyRaw, ['1', 'true', 'yes', 'on'], true);

        $rows = [];
        foreach (PiperVoicesCatalog::all() as $voice) {
            if ($languageFilter !== '' && $voice['language'] !== $languageFilter) {
                continue;
            }
            $row = $installed[$voice['voice_id']] ?? null;
            // installed_only must filter on REAL usability, not on row
            // existence. With async installs, 'installing' / 'failed'
            // placeholder rows live in the table before the model lands on
            // disk; counting them as installed would let API consumers offer
            // voices that GeneratePhraseAction immediately rejects.
            if ($installedOnly && !self::isUsable($row)) {
                continue;
            }
            $rows[] = self::shapeRow($voice, $row);
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
     * Marks orphaned 'installing' rows as failed.
     *
     * The detached installer is the only writer that can flip a row out of
     * 'installing'. If it dies before reaching that write — OOM, php fatal,
     * SIGKILL, host reboot — the row is stuck. We notice on the next list
     * read by comparing `install_started_at` against the threshold, write
     * a synthetic install_error so the UI can explain what happened, and
     * persist the change so future reads stay consistent (no flip-flopping
     * between 'installing' and 'failed' on each request).
     *
     * @param array<string, PhraseStudioVoices> $rows mutated in place
     */
    private static function sweepStaleInstalls(array $rows): void
    {
        $cutoff = time() - self::STALE_INSTALL_THRESHOLD;
        foreach ($rows as $row) {
            if ((string)$row->install_status !== 'installing') {
                continue;
            }
            $started = (int)$row->install_started_at;
            if ($started === 0 || $started >= $cutoff) {
                continue;
            }
            $row->install_status = 'failed';
            $row->install_error  = 'Install timed out — the background process did not finish.';
            $row->save();
        }
    }

    /**
     * "Usable" = row exists AND its install lifecycle is either pre-async
     * legacy ('') or fully completed ('installed'). 'installing' and
     * 'failed' placeholder rows are NOT usable; both `shapeRow` and the
     * `installed_only` filter pivot off this same predicate.
     */
    private static function isUsable(?PhraseStudioVoices $installed): bool
    {
        if ($installed === null) {
            return false;
        }
        $status = (string)($installed->install_status ?? '');
        return $status === '' || $status === 'installed';
    }

    /**
     * @param array<string, mixed> $voice
     * @param PhraseStudioVoices|null $installed
     * @return array<string, mixed>
     */
    private static function shapeRow(array $voice, ?PhraseStudioVoices $installed): array
    {
        // JS uses install_status to show the loader / error state in the row;
        // `installed` mirrors `isUsable()` so REST consumers can keep using
        // the boolean if they don't care about the lifecycle.
        $status = (string)($installed->install_status ?? '');
        $isUsable = self::isUsable($installed);

        return [
            'voice_id'           => (string)$voice['voice_id'],
            'language'           => (string)$voice['language'],
            'language_label'     => (string)$voice['language_label'],
            'voice_name'         => (string)$voice['voice_name'],
            'quality'            => (string)$voice['quality'],
            'sample_rate'        => (int)$voice['sample_rate'],
            'installed'          => $isUsable,
            'size_bytes'         => (int)($installed->size_bytes ?? 0),
            'installed_at'       => (int)($installed->installed_at ?? 0),
            'install_status'     => $status === '' && $installed !== null ? 'installed' : $status,
            'install_error'      => (string)($installed->install_error ?? ''),
            'install_started_at' => (int)($installed->install_started_at ?? 0),
        ];
    }
}
