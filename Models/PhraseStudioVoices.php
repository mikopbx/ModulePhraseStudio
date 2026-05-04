<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Models;

use MikoPBX\Modules\Models\ModulesModelsBase;

/**
 * Inventory of voice models that have been downloaded onto this PBX.
 *
 * One row per (voice_id, quality) pair. The catalogue of *available* voices
 * is built statically by Lib/Engines/PiperVoicesCatalog.php — this table
 * only tracks what the user has actually installed locally.
 *
 * @package Modules\ModulePhraseStudio\Models
 */
class PhraseStudioVoices extends ModulesModelsBase
{
    /**
     * @Primary
     * @Identity
     * @Column(type="integer", nullable=false)
     */
    public $id;

    /**
     * Piper voice identifier in the form "{lang}_{LOCALE}-{name}-{quality}".
     * Example: "ru_RU-irina-medium", "en_US-amy-low".
     *
     * @Column(type="string", nullable=false)
     */
    public ?string $voice_id = '';

    /**
     * Language tag (e.g. "ru-ru", "en-us").
     *
     * @Column(type="string", nullable=true)
     */
    public ?string $language = '';

    /**
     * Human-readable voice name (e.g. "Irina", "Amy").
     *
     * @Column(type="string", nullable=true)
     */
    public ?string $voice_name = '';

    /**
     * Quality label: "x_low" | "low" | "medium" | "high".
     *
     * @Column(type="string", nullable=true)
     */
    public ?string $quality = '';

    /**
     * Absolute path to the .onnx model file on the PBX filesystem.
     *
     * @Column(type="string", nullable=true)
     */
    public ?string $model_path = '';

    /**
     * Absolute path to the matching .onnx.json config file.
     *
     * @Column(type="string", nullable=true)
     */
    public ?string $config_path = '';

    /**
     * Total size on disk in bytes (model + config).
     *
     * @Column(type="integer", default="0", nullable=true)
     */
    public ?string $size_bytes = '0';

    /**
     * Native sample rate of the model in Hz (e.g. "22050", "16000").
     *
     * @Column(type="integer", default="22050", nullable=true)
     */
    public ?string $sample_rate = '22050';

    /**
     * Unix timestamp of when the model finished downloading.
     *
     * @Column(type="integer", default="0", nullable=true)
     */
    public ?string $installed_at = '0';

    public static function getDynamicRelations(&$calledModelObject): void
    {
        // No cross-model relations.
    }

    public function initialize(): void
    {
        $this->setSource('m_ModulePhraseStudio_Voices');
        parent::initialize();
    }
}
