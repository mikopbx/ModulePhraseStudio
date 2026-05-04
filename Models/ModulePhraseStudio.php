<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * Singleton settings row for ModulePhraseStudio.
 *
 * Phalcon model properties follow Phalcon/SQLite conventions:
 *   - Primary key is always untyped: public $id;
 *   - String columns:  public ?string $name = '';
 *   - Integer-as-string columns: public ?string $enabled = '0';
 *
 * @package Modules\ModulePhraseStudio\Models
 */
class ModulePhraseStudio extends ModulesModelsBase
{
    /**
     * @Primary
     * @Identity
     * @Column(type="integer", nullable=false)
     */
    public $id;

    /**
     * Default voice ID (e.g. "ru_RU-irina-medium") used when the user does
     * not pick a specific voice in the Studio UI.
     *
     * @Column(type="string", nullable=true)
     */
    public ?string $default_voice = '';

    /**
     * Default output sample rate. "native" = keep Piper's native 22050 Hz,
     * "telephony" = downsample to 8000 Hz mono via sox.
     *
     * @Column(type="string", nullable=true)
     */
    public ?string $default_sample_rate = 'native';

    /**
     * Auto-resample to 8 kHz mono when generating ('1') or keep native
     * 22 kHz output ('0').
     *
     * @Column(type="integer", default="0", nullable=true)
     */
    public ?string $resample_for_telephony = '0';

    /**
     * Maximum text length accepted by the Generate endpoint (chars).
     * 800 chars ≈ 60s at Piper medium voices average pace — keeps generation
     * predictable and prevents accidental multi-minute phrases.
     *
     * @Column(type="integer", default="800", nullable=true)
     */
    public ?string $max_text_length = '800';

    /**
     * Maximum number of cached phrases kept in db/phrases/. Older entries
     * are pruned when this limit is exceeded.
     *
     * @Column(type="integer", default="500", nullable=true)
     */
    public ?string $cache_size_limit = '500';

    /**
     * Returns dynamic relations between module models and common models.
     *
     * @param mixed $calledModelObject
     */
    public static function getDynamicRelations(&$calledModelObject): void
    {
        // No cross-model relations.
    }

    public function initialize(): void
    {
        $this->setSource('m_ModulePhraseStudio');
        parent::initialize();
    }
}
