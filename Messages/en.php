<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

return [
    // Module metadata
    'BreadcrumbModulePhraseStudio'        => 'Phrase Studio (TTS)',
    'SubHeaderModulePhraseStudio'         => 'Generate voice phrases with Piper TTS directly on the MikoPBX server.',

    // Tabs
    'module_phrase_studio_TabStudio'      => 'Studio',
    'module_phrase_studio_TabVoices'      => 'Voices',
    'module_phrase_studio_TabEngine'      => 'Engine',
    'module_phrase_studio_TabHistory'     => 'History',
    'module_phrase_studio_HistoryHeader'  => 'Generation history',
    'module_phrase_studio_VoiceInstalled_Toast'   => 'Voice installed',
    'module_phrase_studio_VoiceUninstalled_Toast' => 'Voice removed',
    'module_phrase_studio_RowReuseTooltip'        => 'Click to copy text and voice back into the form',
    'module_phrase_studio_RememberDefaults' => 'Remember this choice as default for next phrases',
    'module_phrase_studio_DisabledHeader'   => 'Module is disabled',
    'module_phrase_studio_DisabledHint'     => 'Enable the module on the PBX Extensions page to access Studio, Voices, Engine and History.',

    // Studio tab
    'module_phrase_studio_TextLabel'         => 'Text to synthesise',
    'module_phrase_studio_TextPlaceholder'   => 'Enter the text you want to convert to speech…',
    'module_phrase_studio_VoiceLabel'        => 'Voice',
    'module_phrase_studio_SampleRateLabel'   => 'Sample rate',
    'module_phrase_studio_SampleRateNative'  => 'Native (22 kHz, high quality)',
    'module_phrase_studio_SampleRateTelephony' => 'Telephony (8 kHz, mono)',
    'module_phrase_studio_SampleRatePlaceholder' => 'Pick a sample rate',
    'module_phrase_studio_GenerateButton'    => 'Generate',
    'module_phrase_studio_DownloadButton'    => 'Download .wav',
    'module_phrase_studio_PickerEmpty'       => 'Install at least one voice first',

    // Voices tab
    'module_phrase_studio_VoicesHint'        => 'Pick the languages you need and click "Install". Models are stored locally under db/voices/.',
    'module_phrase_studio_VoicesColLanguage' => 'Language',
    'module_phrase_studio_VoicesColName'     => 'Voice',
    'module_phrase_studio_VoicesColQuality'  => 'Quality',
    'module_phrase_studio_VoicesColRate'     => 'Rate',
    'module_phrase_studio_VoicesColStatus'   => 'Status',
    'module_phrase_studio_VoicesColActions'  => 'Actions',
    'module_phrase_studio_VoiceInstalled'    => 'Installed',
    'module_phrase_studio_VoiceNotInstalled' => 'Not installed',
    'module_phrase_studio_VoiceInstall'      => 'Install',
    'module_phrase_studio_VoiceDelete'       => 'Remove',

    // Engine tab
    'module_phrase_studio_EngineHint'        => 'The Piper binary is downloaded from GitHub the first time you enable the module.',
    'module_phrase_studio_EngineInstalled'   => 'Piper engine installed',
    'module_phrase_studio_EngineNotInstalled'=> 'Piper engine is not installed',
    'module_phrase_studio_EngineVersion'     => 'Version',
    'module_phrase_studio_EngineInstallHint' => 'Click "Install" to download the architecture-matched binary and extract it into db/piper/.',
    'module_phrase_studio_EngineInstall'     => 'Install engine',
    'module_phrase_studio_EngineUninstall'   => 'Uninstall engine',

    // History tab
    'module_phrase_studio_HistoryColCreated'  => 'Created',
    'module_phrase_studio_HistoryColText'     => 'Text',
    'module_phrase_studio_HistoryColVoice'    => 'Voice',
    'module_phrase_studio_HistoryColDuration' => 'Duration',
    'module_phrase_studio_HistoryColPlayer'   => 'Player',
    'module_phrase_studio_HistoryColActions'  => 'Actions',
    'module_phrase_studio_HistoryDelete'      => 'Remove from history',

    // Settings page
    'module_phrase_studio_SettingsTitle'           => 'Phrase Studio Settings',
    'module_phrase_studio_DefaultVoiceLabel'       => 'Default voice',
    'module_phrase_studio_DefaultVoiceHelp'        => 'For example: ru_RU-irina-medium. Used in the Studio when the user has not picked a voice manually.',
    'module_phrase_studio_DefaultSampleRateLabel'  => 'Default sample rate',
    'module_phrase_studio_ResampleForTelephonyLabel' => 'Automatically convert to 8 kHz mono for telephony',
    'module_phrase_studio_MaxTextLengthLabel'      => 'Maximum text length (chars)',
    'module_phrase_studio_CacheSizeLimitLabel'     => 'Phrase cache limit (entries)',

    // Validation
    'module_phrase_studio_ValidationMissing'       => 'Provide text and pick a voice.',
    'module_phrase_studio_ValidateMaxTextLength'   => 'Enter a value between 1 and 10 000.',
    'module_phrase_studio_ValidateCacheSizeLimit'  => 'Enter a value between 0 and 10 000.',

    // Errors
    'module_phrase_studio_ErrorEngineStatus'    => 'Failed to fetch engine status.',
    'module_phrase_studio_ErrorEngineInstall'   => 'Failed to install the Piper engine.',
    'module_phrase_studio_ErrorEngineUninstall' => 'Failed to remove the Piper engine.',
    'module_phrase_studio_ErrorVoicesList'      => 'Failed to load the voice list.',
    'module_phrase_studio_ErrorVoiceInstall'    => 'Failed to download the voice model.',
    'module_phrase_studio_ErrorVoiceUninstall'  => 'Failed to remove the voice model.',
    'module_phrase_studio_ErrorGenerate'        => 'Phrase generation failed.',
    'module_phrase_studio_ErrorHistoryDelete'   => 'Failed to remove the history entry.',
];
