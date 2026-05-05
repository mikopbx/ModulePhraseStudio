<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 *
 * One-shot voice install runner.
 *
 * Invoked from `PhraseStudioMain::installVoice()` via `Processes::mwExecBg`
 * as `php -f install-voice.php <voice_id>`. Runs the full curl download
 * cycle (~30 s – 2 min), persists the result on the PhraseStudioVoices row
 * via `executeVoiceInstall()`, then exits. No persistent worker, no
 * Beanstalk queue — voice installs are rare enough that a daemon process
 * is overkill.
 *
 * Errors are NOT thrown out of the script: they are written into the row's
 * `install_error` column by `executeVoiceInstall()` so the UI can surface
 * them to the user. Any uncaught throwable is logged to syslog and the
 * process exits non-zero (no consumer to receive it, but visible in logs).
 */

namespace Modules\ModulePhraseStudio\Lib\Cli;

require_once 'Globals.php';

use MikoPBX\Common\Handlers\CriticalErrorsHandler;
use Modules\ModulePhraseStudio\Lib\PhraseStudioMain;

if (PHP_SAPI !== 'cli') {
    return;
}

$voiceId = (string)($argv[1] ?? '');
if ($voiceId === '') {
    fwrite(STDERR, "usage: install-voice.php <voice_id>\n");
    exit(2);
}

cli_set_process_title('PhraseStudio:install-voice ' . $voiceId);

try {
    (new PhraseStudioMain())->executeVoiceInstall($voiceId);
} catch (\Throwable $e) {
    CriticalErrorsHandler::handleExceptionWithSyslog($e);
    exit(1);
}
