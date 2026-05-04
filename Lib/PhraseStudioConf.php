<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib;

use MikoPBX\Modules\Config\ConfigClass;

/**
 * ConfigClass for ModulePhraseStudio.
 *
 * REST API uses Pattern 3 (auto-discovery via #[ApiResource] attributes
 * on Lib/RestAPI/{Resource}/Controller.php), so no manual route
 * registration is required here — ConfigClass already implements
 * RestAPIConfigInterface with empty stubs.
 *
 * UI integration:
 *   - onVoltBlockCompile() injects a TTS block into the SoundFiles modify form.
 *   - onAfterAssetsPrepared() ships the JS that drives that block.
 *
 * Cleanup-on-disable: when the module is disabled in the UI we keep
 * the user's downloaded engine binary, voice models and generated
 * phrases on disk. They will be picked up again automatically when
 * the module is re-enabled. Full uninstall removes everything via
 * PbxExtensionSetupBase::unInstallFiles() / unInstallDB().
 *
 * @package Modules\ModulePhraseStudio\Lib
 */
class PhraseStudioConf extends ConfigClass
{
    public const string MODULE_UNIQUE_ID = 'ModulePhraseStudio';

    /**
     * Called once after the module is enabled in the admin cabinet.
     *
     * Ensures the persistent storage subdirectories exist. We do not
     * download anything here — engine binary and voice models are
     * fetched on demand from the Studio UI.
     */
    public function onAfterModuleEnable(): void
    {
        $main = new PhraseStudioMain();
        $main->ensureStorageLayout();
    }

    /**
     * Called once after the module is disabled in the admin cabinet.
     *
     * Intentionally a no-op: we leave the user's engine binary, models
     * and phrase cache on disk so re-enabling is instant.
     */
    public function onAfterModuleDisable(): void
    {
        // No-op by design.
    }

    /**
     * Hooks the SoundFiles "modify" form: when MikoPBX core renders
     * `hookVoltBlock('Fields')` inside SoundFiles/modify.volt we hand back
     * the path to our partial so the form gains a "Generate via TTS" segment.
     *
     * @param string                 $controller The called controller name.
     * @param string                 $blockName  The named block in the volt template.
     * @param \Phalcon\Mvc\View       $view      The view instance (unused).
     */
    public function onVoltBlockCompile(string $controller, string $blockName, $view): string
    {
        if ($controller === 'SoundFiles' && $blockName === 'Fields') {
            return 'Modules/' . self::MODULE_UNIQUE_ID . '/SoundFiles/modify';
        }
        return '';
    }

    /**
     * Ships the JS that drives the TTS block on the SoundFiles modify page.
     *
     * The JS detaches the partial-rendered form from the bottom of the page
     * and reinserts it under the "upload / record" segment, so the block
     * appears where it logically belongs without modifying core volts.
     */
    public function onAfterAssetsPrepared($assets, $dispatcher): void
    {
        if ($dispatcher->getControllerName() !== 'SoundFiles') {
            return;
        }
        if ($dispatcher->getActionName() !== 'modify') {
            return;
        }

        $assets->collection('footerJS')
            ->addJs('js/cache/' . self::MODULE_UNIQUE_ID . '/module-phrase-studio-soundfiles.js', true);
    }
}
