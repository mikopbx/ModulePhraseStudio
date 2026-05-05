<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

namespace Modules\ModulePhraseStudio\Lib;

use MikoPBX\Core\System\Processes;
use MikoPBX\Core\System\Upgrade\UpdateDatabase;
use MikoPBX\Core\System\Util;
use MikoPBX\Modules\Config\ConfigClass;
use Modules\ModulePhraseStudio\Lib\Engines\PiperEngine;
use Modules\ModulePhraseStudio\Models\PhraseStudioVoices;

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
     * Ensures the persistent storage subdirectories exist, reconciles the
     * SQLite schema, and (if missing) kicks off a detached download of the
     * Piper engine binary so the module is usable straight after enable.
     */
    public function onAfterModuleEnable(): void
    {
        $main = new PhraseStudioMain();
        $main->ensureStorageLayout();

        // Reconcile the SQLite schema against the current model annotations.
        // EnableModuleAction does NOT auto-run this — only the initial install
        // does. Without it, columns added in later versions (e.g. async-install
        // status fields on PhraseStudioVoices) never reach the DB and `save()`
        // silently drops them. Calling createUpdateDbTableByAnnotations is
        // idempotent (uses ALTER TABLE ADD COLUMN under the hood, no-op when
        // columns already match), so it is safe on every enable.
        try {
            (new UpdateDatabase())->createUpdateDbTableByAnnotations(PhraseStudioVoices::class);
        } catch (\Throwable $e) {
            // Don't block enable on a schema reconcile failure — the rest of
            // the module still works and an admin can investigate via syslog.
        }

        // Auto-bootstrap the Piper binary if it isn't already on disk.
        // Without this, every fresh install greets the user with a useless
        // "Engine not installed" page and a manual button. Same detached-
        // runner pattern as voice install — REST returns immediately, the
        // ~25 MB tarball downloads in the background, and the Engine tab
        // status flips to "installed" once the binary lands at its final
        // path. PiperEngine::isInstalled() is file-presence based, so a
        // half-finished download never falsely reports success.
        if (!(new PiperEngine())->isInstalled()) {
            $php    = Util::which('php');
            $script = __DIR__ . '/Cli/install-engine.php';
            if ($php !== '' && is_file($script)) {
                Processes::mwExecBg(
                    sprintf('%s -f %s', escapeshellarg($php), escapeshellarg($script)),
                    '/dev/null'
                );
            }
        }
    }

    /**
     * Called once after the module is disabled in the admin cabinet.
     *
     * Intentionally a no-op: there are no persistent workers to stop
     * (synthesize / promote run inline; voice install runs in a one-shot
     * detached php process from `PhraseStudioMain::installVoice()`).
     * Engine binary, voice models and phrase cache stay on disk so
     * re-enabling is instant.
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
