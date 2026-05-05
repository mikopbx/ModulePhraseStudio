<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 *
 * One-shot Piper engine install runner.
 *
 * Invoked from `PhraseStudioConf::onAfterModuleEnable()` via
 * `Processes::mwExecBg` when the module is enabled and the binary is
 * not yet on disk. Downloads + extracts the architecture-matched
 * Piper tarball (~25 MB) into `db/piper/`. Runs detached so the enable
 * REST call returns immediately even on slow networks.
 *
 * `PiperEngine::install()` is idempotent: it short-circuits cleanly on
 * a half-extracted archive, and `isInstalled()` only flips true after
 * the binary lands at its final path — so the Engine status endpoint
 * keeps reporting "not installed" until the download genuinely succeeds.
 */

namespace Modules\ModulePhraseStudio\Lib\Cli;

require_once 'Globals.php';

use MikoPBX\Common\Handlers\CriticalErrorsHandler;
use Modules\ModulePhraseStudio\Lib\Engines\PiperEngine;

if (PHP_SAPI !== 'cli') {
    return;
}

cli_set_process_title('PhraseStudio:install-engine');

try {
    $engine = new PiperEngine();
    if ($engine->isInstalled()) {
        // Concurrent enable / manual click race — nothing to do.
        exit(0);
    }
    $result = $engine->install();
    if (empty($result['success'])) {
        // No DB row to flag (engine has no per-row status), so the only
        // observability is syslog. The next click of "Install engine" in
        // the UI will retry through the same code path.
        fwrite(STDERR, 'engine install failed: ' . (string)($result['message'] ?? '') . "\n");
        exit(1);
    }
} catch (\Throwable $e) {
    CriticalErrorsHandler::handleExceptionWithSyslog($e);
    exit(1);
}
