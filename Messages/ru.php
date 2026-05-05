<?php

declare(strict_types=1);

/*
 * MikoPBX - free phone system for small business
 * Copyright © 2017-2026 Alexey Portnov and Nikolay Beketov
 */

return [
    // Module metadata (shown in marketplace)
    'BreadcrumbModulePhraseStudio'        => 'Студия фраз (TTS)',
    'SubHeaderModulePhraseStudio'         => 'Генерация голосовых фраз через Piper TTS прямо на сервере MikoPBX.',

    // Tabs
    'module_phrase_studio_TabStudio'      => 'Студия',
    'module_phrase_studio_TabVoices'      => 'Голоса',
    'module_phrase_studio_TabEngine'      => 'Движок',
    'module_phrase_studio_TabHistory'     => 'История',
    'module_phrase_studio_HistoryHeader'  => 'История генерации',
    'module_phrase_studio_VoiceInstalled_Toast'   => 'Голос установлен',
    'module_phrase_studio_VoiceUninstalled_Toast' => 'Голос удалён',
    'module_phrase_studio_RowReuseTooltip'        => 'Кликните, чтобы скопировать текст и голос обратно в форму',
    'module_phrase_studio_HistoryEmptyTitle'      => 'Здесь пока пусто',
    'module_phrase_studio_HistoryEmptyDescription' => 'Сгенерируйте первую фразу через форму выше — записи появятся в этом списке.',
    'module_phrase_studio_RememberDefaults' => 'Запомнить выбор как эталон для следующих фраз',
    'module_phrase_studio_DisabledHeader'   => 'Модуль выключен',
    'module_phrase_studio_DisabledHint'     => 'Включите модуль на странице «PBX Extensions», чтобы получить доступ к Студии, Голосам, Движку и Истории.',

    // Studio tab
    'module_phrase_studio_TextLabel'         => 'Текст для синтеза',
    'module_phrase_studio_TextPlaceholder'   => 'Введите текст, который нужно озвучить…',
    'module_phrase_studio_VoiceLabel'        => 'Голос',
    'module_phrase_studio_SampleRateLabel'   => 'Частота дискретизации',
    'module_phrase_studio_SampleRateNative'  => 'Исходная (22 кГц, высокое качество)',
    'module_phrase_studio_SampleRateTelephony' => 'Телефония (8 кГц, моно)',
    'module_phrase_studio_SampleRatePlaceholder' => 'Выберите частоту',
    'module_phrase_studio_GenerateButton'    => 'Сгенерировать',
    'module_phrase_studio_DownloadButton'    => 'Скачать .wav',
    'module_phrase_studio_PickerEmpty'       => 'Сначала установите хотя бы один голос',

    // Voices tab
    'module_phrase_studio_VoicesHint'        => 'Выберите нужные языки и нажмите «Загрузить». Модели хранятся локально в db/voices/.',
    'module_phrase_studio_VoicesColLanguage' => 'Язык',
    'module_phrase_studio_VoicesColName'     => 'Голос',
    'module_phrase_studio_VoicesColQuality'  => 'Качество',
    'module_phrase_studio_VoicesColRate'     => 'Частота',
    'module_phrase_studio_VoicesColStatus'   => 'Статус',
    'module_phrase_studio_VoicesColActions'  => 'Действия',
    'module_phrase_studio_VoiceInstalled'    => 'Установлен',
    'module_phrase_studio_VoiceNotInstalled' => 'Не установлен',
    'module_phrase_studio_VoiceInstalling'   => 'Скачивается…',
    'module_phrase_studio_VoiceFailed'       => 'Ошибка установки',
    'module_phrase_studio_VoiceInstall'      => 'Загрузить',
    'module_phrase_studio_VoiceRetry'        => 'Повторить',
    'module_phrase_studio_VoiceDelete'       => 'Удалить',
    'module_phrase_studio_VoiceInstallQueued_Toast' => 'Загрузка голоса поставлена в очередь — продолжаем скачивание в фоне',
    'module_phrase_studio_VoiceInstallTimeout'      => 'Загрузка голоса идёт дольше ожидаемого — обновите страницу, чтобы увидеть итог.',
    'module_phrase_studio_VoiceNotInstalledError'   => 'Голос не установлен:',

    // Engine tab
    'module_phrase_studio_EngineHint'        => 'Бинарь Piper загружается с GitHub при первом включении модуля.',
    'module_phrase_studio_EngineInstalled'   => 'Движок Piper установлен',
    'module_phrase_studio_EngineNotInstalled'=> 'Движок Piper не установлен',
    'module_phrase_studio_EngineVersion'     => 'Версия',
    'module_phrase_studio_EngineInstallHint' => 'Нажмите «Установить», чтобы скачать архитектурно-совместимый бинарь и распаковать его в db/piper/.',
    'module_phrase_studio_EngineInstall'     => 'Установить движок',
    'module_phrase_studio_EngineUpdate'      => 'Обновить движок',
    'module_phrase_studio_EngineUninstall'   => 'Удалить движок',

    // History tab
    'module_phrase_studio_HistoryColCreated'  => 'Создано',
    'module_phrase_studio_HistoryColText'     => 'Текст',
    'module_phrase_studio_HistoryColVoice'    => 'Голос',
    'module_phrase_studio_HistoryColDuration' => 'Длительность',
    'module_phrase_studio_HistoryColPlayer'   => 'Плеер',
    'module_phrase_studio_HistoryColActions'  => 'Действия',
    'module_phrase_studio_HistoryDelete'      => 'Удалить запись',

    // Settings page
    'module_phrase_studio_SettingsTitle'           => 'Настройки студии фраз',
    'module_phrase_studio_DefaultVoiceLabel'       => 'Голос по умолчанию',
    'module_phrase_studio_DefaultVoiceHelp'        => 'Например: ru_RU-irina-medium. Используется в Студии, когда пользователь не выбрал голос вручную.',
    'module_phrase_studio_DefaultSampleRateLabel'  => 'Частота дискретизации по умолчанию',
    'module_phrase_studio_ResampleForTelephonyLabel' => 'Автоматически конвертировать в 8 кГц моно для телефонии',
    'module_phrase_studio_MaxTextLengthLabel'      => 'Максимальная длина текста (символов)',
    'module_phrase_studio_CacheSizeLimitLabel'     => 'Лимит кэша фраз (записей)',

    // Validation
    'module_phrase_studio_ValidationMissing'       => 'Заполните текст и выберите голос.',
    'module_phrase_studio_ValidateMaxTextLength'   => 'Введите число от 1 до 10 000.',
    'module_phrase_studio_ValidateCacheSizeLimit'  => 'Введите число от 0 до 10 000.',

    // SoundFiles modify hook
    'module_phrase_studio_SoundFilesHookHeader'   => 'Сгенерировать из текста (Студия фраз)',
    'module_phrase_studio_SoundFilesHookSub'      => 'Озвучьте фразу через Piper и используйте результат в качестве исходника для этого файла.',
    'module_phrase_studio_SoundFilesHookGenerate' => 'Сгенерировать и использовать',
    'module_phrase_studio_SoundFilesHookSuccess'  => 'Сгенерированная фраза подгружена как исходник.',
    'module_phrase_studio_SoundFilesHookNoVoice'  => 'Сначала установите хотя бы один голос в Студии фраз.',
    'module_phrase_studio_SoundFilesHookEngineOff' => 'Движок Piper не установлен. Откройте «Студия фраз → Движок» и установите его.',
    'module_phrase_studio_SoundFilesHookHistoryLabel' => 'Использовать ранее сгенерированную фразу',
    'module_phrase_studio_SoundFilesHookHistoryPlaceholder' => 'Выберите фразу из истории…',

    // Errors
    'module_phrase_studio_ErrorEngineStatus'    => 'Не удалось получить статус движка.',
    'module_phrase_studio_ErrorEngineInstall'   => 'Не удалось установить движок Piper.',
    'module_phrase_studio_ErrorEngineUninstall' => 'Не удалось удалить движок Piper.',
    'module_phrase_studio_ErrorVoicesList'      => 'Не удалось получить список голосов.',
    'module_phrase_studio_ErrorVoiceInstall'    => 'Не удалось загрузить модель голоса.',
    'module_phrase_studio_ErrorVoiceUninstall'  => 'Не удалось удалить модель голоса.',
    'module_phrase_studio_ErrorGenerate'        => 'Ошибка при генерации фразы.',
    'module_phrase_studio_ErrorHistoryDelete'   => 'Не удалось удалить запись из истории.',
];
