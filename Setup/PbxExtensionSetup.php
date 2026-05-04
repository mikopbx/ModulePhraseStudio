<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation; either version 3 of the License, or
 * (at your option) any later version.
 */

namespace Modules\ModulePhraseStudio\Setup;

use MikoPBX\Modules\Setup\PbxExtensionSetupBase;

/**
 * ModulePhraseStudio installer / uninstaller.
 *
 * Database tables are auto-created from Phalcon annotations on the model
 * classes in Models/. REST API routes are auto-discovered by RouterProvider
 * from Lib/RestAPI/{Resource}/Controller.php with #[ApiResource] attribute.
 *
 * Persistent storage layout (under module's writable db/ symlink):
 *   db/piper/   — piper engine binary (downloaded on demand)
 *   db/voices/  — installed voice models (downloaded on demand)
 *   db/phrases/ — generated phrases cache
 *
 * @package Modules\ModulePhraseStudio\Setup
 */
class PbxExtensionSetup extends PbxExtensionSetupBase
{
    // No custom logic required:
    // - DB tables auto-generated from Models/ annotations
    // - REST routes auto-discovered from Lib/RestAPI/*/Controller.php
    // - Engine binary and voice models are downloaded at runtime via the UI,
    //   so installFiles()/installDB() require no extras here.
}
