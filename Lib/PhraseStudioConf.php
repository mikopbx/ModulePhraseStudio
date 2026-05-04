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
}
