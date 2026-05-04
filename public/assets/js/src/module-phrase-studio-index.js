/* global $, globalRootUrl, globalTranslate, PbxApi, UserMessage */

/**
 * Studio page controller for ModulePhraseStudio.
 *
 * The page has four tabs (studio / voices / engine / history). All data flows
 * through the module's REST v3 endpoints under /pbxcore/api/v3/module-phrase-studio.
 * We rely on PbxApi.callJsonRest helper, which already handles auth headers.
 */
const phraseStudioIndex = {
    api: {
        engine:        '/pbxcore/api/v3/module-phrase-studio/engine',
        engineInstall: '/pbxcore/api/v3/module-phrase-studio/engine:install',
        voices:        '/pbxcore/api/v3/module-phrase-studio/voices',
        voiceInstall:  '/pbxcore/api/v3/module-phrase-studio/voices:install',
        phrases:       '/pbxcore/api/v3/module-phrase-studio/phrases',
        saveDefaults:  globalRootUrl + 'module-phrase-studio/module-phrase-studio/save',
    },

    state: {
        engine: null,
        voices: [],
    },

    initialize() {
        $('#phrase-studio-tab-menu .item').tab();
        $('#phrase-studio-remember-checkbox').checkbox();
        $('#phrase-studio-sample-rate').dropdown();
        $('#phrase-studio-text').on('input', phraseStudioIndex.updateCounter);
        $('#phrase-studio-generate-button').on('click', phraseStudioIndex.onGenerate);
        $('[data-tab="voices"]').on('click', phraseStudioIndex.refreshVoices);
        $('[data-tab="engine"]').on('click', phraseStudioIndex.refreshEngine);
        $('[data-tab="history"]').on('click', phraseStudioIndex.refreshHistory);

        phraseStudioIndex.applyDefaults();
        phraseStudioIndex.refreshEngine();
        phraseStudioIndex.refreshVoices();
        phraseStudioIndex.refreshHistory();
    },

    applyDefaults() {
        const d = window.phraseStudioDefaults || {};
        if (d.sampleRate) {
            $('#phrase-studio-sample-rate').dropdown('set selected', d.sampleRate);
        }
    },

    updateCounter() {
        const value = $('#phrase-studio-text').val() || '';
        const max   = parseInt($('#phrase-studio-text').attr('maxlength') || '800', 10);
        $('#phrase-studio-text-counter').text(`${value.length} / ${max}`);
    },

    refreshEngine() {
        $.ajax({
            url: phraseStudioIndex.api.engine,
            method: 'GET',
            dataType: 'json',
        }).done((response) => {
            phraseStudioIndex.state.engine = (response && response.data) || null;
            phraseStudioIndex.renderEngine();
        }).fail(() => {
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorEngineStatus);
        });
    },

    renderEngine() {
        const $box = $('#phrase-studio-engine-status').empty();
        const data = phraseStudioIndex.state.engine || {};
        if (data.installed) {
            $box.append(
                $('<div>').addClass('ui positive message')
                    .append($('<div>').addClass('header').text(globalTranslate.module_phrase_studio_EngineInstalled))
                    .append($('<p>').text(`${globalTranslate.module_phrase_studio_EngineVersion}: ${data.version || '—'}`))
                    .append(
                        $('<button>')
                            .addClass('ui small red basic button')
                            .text(globalTranslate.module_phrase_studio_EngineUninstall)
                            .on('click', phraseStudioIndex.onEngineUninstall)
                    )
            );
        } else {
            $box.append(
                $('<div>').addClass('ui warning message')
                    .append($('<div>').addClass('header').text(globalTranslate.module_phrase_studio_EngineNotInstalled))
                    .append($('<p>').text(globalTranslate.module_phrase_studio_EngineInstallHint))
                    .append(
                        $('<button>')
                            .addClass('ui primary button')
                            .text(globalTranslate.module_phrase_studio_EngineInstall)
                            .on('click', phraseStudioIndex.onEngineInstall)
                    )
            );
        }
    },

    onEngineInstall() {
        const $btn = $(this);
        $btn.addClass('loading disabled');
        $.ajax({
            url: phraseStudioIndex.api.engineInstall,
            method: 'POST',
            dataType: 'json',
        }).done((response) => {
            $btn.removeClass('loading disabled');
            phraseStudioIndex.refreshEngine();
            if (response && response.result === false) {
                UserMessage.showMultiString(response.messages);
            }
        }).fail(() => {
            $btn.removeClass('loading disabled');
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorEngineInstall);
        });
    },

    onEngineUninstall() {
        const $btn = $(this);
        $btn.addClass('loading disabled');
        $.ajax({
            url: phraseStudioIndex.api.engine,
            method: 'DELETE',
            dataType: 'json',
        }).done(() => {
            $btn.removeClass('loading disabled');
            phraseStudioIndex.refreshEngine();
        }).fail(() => {
            $btn.removeClass('loading disabled');
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorEngineUninstall);
        });
    },

    refreshVoices() {
        $.ajax({
            url: phraseStudioIndex.api.voices,
            method: 'GET',
            dataType: 'json',
        }).done((response) => {
            phraseStudioIndex.state.voices = (response && response.data) || [];
            phraseStudioIndex.renderVoicesTable();
            phraseStudioIndex.renderVoicePicker();
        }).fail(() => {
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorVoicesList);
        });
    },

    renderVoicesTable() {
        const $tbody = $('#phrase-studio-voices-table tbody').empty();
        phraseStudioIndex.state.voices.forEach((voice) => {
            const $row = $('<tr>');
            $row.append($('<td>').text(`${voice.language_label} (${voice.language})`));
            $row.append($('<td>').text(voice.voice_name));
            $row.append($('<td>').text(voice.quality));
            $row.append($('<td>').text(`${voice.sample_rate} Hz`));
            $row.append($('<td>').html(voice.installed
                ? `<span class="ui green label">${globalTranslate.module_phrase_studio_VoiceInstalled}</span>`
                : `<span class="ui label">${globalTranslate.module_phrase_studio_VoiceNotInstalled}</span>`));
            const $actions = $('<td>').addClass('right aligned');
            if (voice.installed) {
                $actions.append(
                    $('<button>').addClass('ui small basic red icon button')
                        .attr('data-voice', voice.voice_id)
                        .attr('title', globalTranslate.module_phrase_studio_VoiceDelete)
                        .append('<i class="trash icon"></i>')
                        .on('click', phraseStudioIndex.onVoiceUninstall)
                );
            } else {
                $actions.append(
                    $('<button>').addClass('ui small primary icon button')
                        .attr('data-voice', voice.voice_id)
                        .attr('title', globalTranslate.module_phrase_studio_VoiceInstall)
                        .append('<i class="download icon"></i>')
                        .on('click', phraseStudioIndex.onVoiceInstall)
                );
            }
            $row.append($actions);
            $tbody.append($row);
        });
    },

    renderVoicePicker() {
        const $select = $('#phrase-studio-voice');
        const previous = $select.val();
        const fallback = (window.phraseStudioDefaults || {}).voice || '';
        $select.empty();
        const installed = phraseStudioIndex.state.voices.filter((v) => v.installed);
        if (installed.length === 0) {
            $select.append($('<option>').val('').text(globalTranslate.module_phrase_studio_PickerEmpty));
        } else {
            installed.forEach((voice) => {
                $select.append(
                    $('<option>')
                        .val(voice.voice_id)
                        .text(`${voice.language_label} — ${voice.voice_name} (${voice.quality})`)
                );
            });
        }
        $select.dropdown({fullTextSearch: true});
        const want = previous || fallback;
        if (want) {
            $select.dropdown('set selected', want);
        }
    },

    onVoiceInstall() {
        const $btn = $(this);
        const voiceId = $btn.data('voice');
        $btn.addClass('loading disabled');
        $.ajax({
            url: phraseStudioIndex.api.voiceInstall,
            method: 'POST',
            data: JSON.stringify({voice_id: voiceId}),
            contentType: 'application/json',
            dataType: 'json',
        }).done(() => {
            phraseStudioIndex.refreshVoices();
        }).fail(() => {
            $btn.removeClass('loading disabled');
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorVoiceInstall);
        });
    },

    onVoiceUninstall() {
        const $btn = $(this);
        const voiceId = $btn.data('voice');
        $btn.addClass('loading disabled');
        $.ajax({
            url: `${phraseStudioIndex.api.voices}/${encodeURIComponent(voiceId)}`,
            method: 'DELETE',
            dataType: 'json',
        }).done(() => {
            phraseStudioIndex.refreshVoices();
        }).fail(() => {
            $btn.removeClass('loading disabled');
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorVoiceUninstall);
        });
    },

    onGenerate() {
        const text       = ($('#phrase-studio-text').val() || '').trim();
        const voiceId    = $('#phrase-studio-voice').val() || '';
        const sampleRate = $('#phrase-studio-sample-rate').val() || 'native';
        if (!text || !voiceId) {
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_ValidationMissing);
            return;
        }
        const $btn = $('#phrase-studio-generate-button').addClass('loading disabled');
        $.ajax({
            url: phraseStudioIndex.api.phrases,
            method: 'POST',
            data: JSON.stringify({text, voice_id: voiceId, sample_rate: sampleRate}),
            contentType: 'application/json',
            dataType: 'json',
        }).done((response) => {
            $btn.removeClass('loading disabled');
            const data = response && response.data;
            if (!data || !data.phrase_id) {
                UserMessage.showMultiString(response && response.messages
                    ? response.messages
                    : globalTranslate.module_phrase_studio_ErrorGenerate);
                return;
            }
            const downloadUrl = `${phraseStudioIndex.api.phrases}/${data.phrase_id}:download`;
            $('#phrase-studio-player').attr('src', downloadUrl).get(0).load();
            $('#phrase-studio-download-link')
                .attr('href', downloadUrl)
                .attr('download', `phrase_${data.phrase_id}.wav`);
            $('#phrase-studio-result').show();
            if ($('#phrase-studio-remember').is(':checked')) {
                phraseStudioIndex.persistDefaults(voiceId, sampleRate);
            }
            phraseStudioIndex.refreshHistory();
        }).fail(() => {
            $btn.removeClass('loading disabled');
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorGenerate);
        });
    },

    persistDefaults(voiceId, sampleRate) {
        $.ajax({
            url: phraseStudioIndex.api.saveDefaults,
            method: 'POST',
            data: {default_voice: voiceId, default_sample_rate: sampleRate},
        }).done(() => {
            window.phraseStudioDefaults = {voice: voiceId, sampleRate};
        });
    },

    refreshHistory() {
        $.ajax({
            url: phraseStudioIndex.api.phrases,
            method: 'GET',
            dataType: 'json',
        }).done((response) => {
            phraseStudioIndex.renderHistory((response && response.data) || []);
        });
    },

    renderHistory(rows) {
        const $tbody = $('#phrase-studio-history-table tbody').empty();
        rows.forEach((row) => {
            const created = row.created_at
                ? new Date(row.created_at * 1000).toLocaleString()
                : '—';
            const duration = row.duration_ms
                ? `${(row.duration_ms / 1000).toFixed(1)} s`
                : '—';
            const downloadUrl = `${phraseStudioIndex.api.phrases}/${row.id}:download`;
            const $tr = $('<tr>');
            $tr.append($('<td>').text(created));
            $tr.append($('<td>').text((row.text || '').substring(0, 80)));
            $tr.append($('<td>').text(row.voice_id || ''));
            $tr.append($('<td>').text(duration));
            const $player = $('<audio>')
                .attr({controls: 'controls', preload: 'none', src: downloadUrl})
                .css({width: '220px', verticalAlign: 'middle'});
            $tr.append($('<td>').append($player));
            $tr.append($('<td>').addClass('right aligned')
                .append(`<a class="ui small basic icon button" href="${downloadUrl}" download="phrase_${row.id}.wav" title="${globalTranslate.module_phrase_studio_DownloadButton}"><i class="download icon"></i></a>`)
                .append(
                    $('<button>').addClass('ui small basic red icon button')
                        .attr('data-id', row.id)
                        .attr('title', globalTranslate.module_phrase_studio_HistoryDelete)
                        .append('<i class="trash icon"></i>')
                        .on('click', phraseStudioIndex.onHistoryDelete)
                ));
            $tbody.append($tr);
        });
    },

    onHistoryDelete() {
        const id = $(this).data('id');
        $.ajax({
            url: `${phraseStudioIndex.api.phrases}/${id}`,
            method: 'DELETE',
            dataType: 'json',
        }).done(phraseStudioIndex.refreshHistory)
          .fail(() => UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorHistoryDelete));
    },
};

$(document).ready(() => {
    phraseStudioIndex.initialize();
});
