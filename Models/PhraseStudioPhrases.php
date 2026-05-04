<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * History of generated phrases.
 *
 * Cache key is md5(text + voice_id + sample_rate); when the same
 * (text, voice, rate) triple is requested again, no re-synthesis is
 * performed — the existing wav file is returned.
 *
 * @package Modules\ModulePhraseStudio\Models
 */
class PhraseStudioPhrases extends ModulesModelsBase
{
    /**
     * @Primary
     * @Identity
     * @Column(type="integer", nullable=false)
     */
    public $id;

    /**
     * Cache key: md5(text + voice_id + sample_rate).
     *
     * @Column(type="string", nullable=false)
     */
    public ?string $cache_key = '';

    /**
     * Original text supplied by the user (kept for the history list).
     * Limited to ModulePhraseStudio::max_text_length characters.
     *
     * @Column(type="string", nullable=true)
     */
    public ?string $text = '';

    /**
     * Voice identifier used for synthesis (e.g. "ru_RU-irina-medium").
     *
     * @Column(type="string", nullable=true)
     */
    public ?string $voice_id = '';

    /**
     * Output sample rate in Hz ("22050" = native, "8000" = telephony).
     *
     * @Column(type="integer", default="22050", nullable=true)
     */
    public ?string $sample_rate = '22050';

    /**
     * Absolute path to the cached .wav file on the PBX filesystem.
     *
     * @Column(type="string", nullable=true)
     */
    public ?string $file_path = '';

    /**
     * Audio duration in milliseconds (best-effort, computed via sox/ffprobe).
     *
     * @Column(type="integer", default="0", nullable=true)
     */
    public ?string $duration_ms = '0';

    /**
     * File size in bytes.
     *
     * @Column(type="integer", default="0", nullable=true)
     */
    public ?string $size_bytes = '0';

    /**
     * Unix timestamp of when the file was generated.
     *
     * @Column(type="integer", default="0", nullable=true)
     */
    public ?string $created_at = '0';

    public static function getDynamicRelations(&$calledModelObject): void
    {
        // No cross-model relations.
    }

    public function initialize(): void
    {
        $this->setSource('m_ModulePhraseStudio_Phrases');
        parent::initialize();
    }
}
