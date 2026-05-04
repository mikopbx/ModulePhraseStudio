/* global $, globalRootUrl, globalTranslate, PbxApi, UserMessage, IndexSoundPlayer, TokenManager, SemanticLocalization */

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
        soundPlayers: {},
        historyDataTable: null,
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
            if ($('#phrase-studio-remember').is(':checked')) {
                phraseStudioIndex.persistDefaults(voiceId, sampleRate);
            }
            // Switch to History tab — the new row carries the standard
            // SoundFiles-style player so the user can listen and download
            // there. Avoids duplicating the player UI on the Studio tab.
            phraseStudioIndex.refreshHistory(() => {
                $('#phrase-studio-tab-menu .item[data-tab=history]').tab('change tab', 'history');
            });
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

    refreshHistory(callback) {
        $.ajax({
            url: phraseStudioIndex.api.phrases,
            method: 'GET',
            dataType: 'json',
        }).done((response) => {
            phraseStudioIndex.renderHistory((response && response.data) || []);
            if (typeof callback === 'function') {
                callback();
            }
        });
    },

    renderHistory(rows) {
        // Tear down DataTable + sound players from the previous render.
        if (phraseStudioIndex.state.historyDataTable
            && $.fn.DataTable.isDataTable('#phrase-studio-history-table')) {
            phraseStudioIndex.state.historyDataTable.destroy();
            phraseStudioIndex.state.historyDataTable = null;
        }
        Object.values(phraseStudioIndex.state.soundPlayers).forEach((p) => {
            if (p && p.html5Audio) {
                p.html5Audio.pause();
                p.html5Audio.src = '';
            }
        });
        phraseStudioIndex.state.soundPlayers = {};

        const $tbody = $('#phrase-studio-history-table tbody').empty();
        rows.forEach((row) => {
            $tbody.append(phraseStudioIndex.renderHistoryRow(row));
        });

        if (rows.length === 0) {
            return;
        }

        // Initialise DataTable + sound players, mirroring SoundFiles index.
        phraseStudioIndex.state.historyDataTable = $('#phrase-studio-history-table').DataTable({
            lengthChange: false,
            paging: true,
            pageLength: 25,
            searching: true,
            info: false,
            ordering: true,
            language: typeof SemanticLocalization !== 'undefined'
                ? SemanticLocalization.dataTableLocalisation
                : undefined,
            order: [[0, 'desc']],
        });

        rows.forEach((row) => {
            phraseStudioIndex.state.soundPlayers[row.id] =
                new IndexSoundPlayer(`phrase-row-${row.id}`);
        });

        $('#phrase-studio-history-table').on('click', 'button.delete-button', function onDelete(e) {
            e.preventDefault();
            const id = $(this).data('id');
            if (!id) return;
            $.ajax({
                url: `${phraseStudioIndex.api.phrases}/${id}`,
                method: 'DELETE',
                dataType: 'json',
            }).done(() => phraseStudioIndex.refreshHistory())
              .fail(() => UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorHistoryDelete));
        });
    },

    renderHistoryRow(row) {
        const created  = row.created_at ? new Date(row.created_at * 1000).toLocaleString() : '—';
        const text     = (row.text || '').substring(0, 80);
        const voiceId  = row.voice_id || '';
        const playUrl  = `${phraseStudioIndex.api.phrases}/${row.id}:download`;
        const dlUrl    = playUrl;
        const filename = `phrase_${row.id}.wav`;
        return `<tr class="file-row" id="phrase-row-${row.id}" data-value="${playUrl}">
            <td>${$('<div>').text(created).html()}</td>
            <td><i class="file audio outline icon"></i>${$('<div>').text(text).html()}</td>
            <td>${$('<div>').text(voiceId).html()}</td>
            <td class="six wide cdr-player hide-on-mobile">
                <table>
                    <tr>
                        <td class="one wide">
                            <button class="ui tiny basic icon button play-button">
                                <i class="ui icon play"></i>
                            </button>
                            <audio preload="none" id="audio-player-phrase-row-${row.id}" data-src="${playUrl}">
                                <source src=""/>
                            </audio>
                        </td>
                        <td>
                            <div class="ui range cdr-player"></div>
                        </td>
                        <td class="one wide"><span class="cdr-duration"></span></td>
                        <td class="one wide">
                            <button class="ui tiny basic icon button download-button" data-value="${dlUrl}?filename=${filename}">
                                <i class="ui icon download"></i>
                            </button>
                        </td>
                    </tr>
                </table>
            </td>
            <td class="collapsing">
                <div class="ui tiny basic icon buttons action-buttons">
                    <button class="ui button delete-button" data-id="${row.id}"
                            title="${globalTranslate.module_phrase_studio_HistoryDelete}">
                        <i class="icon trash red"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    },
};

$(document).ready(() => {
    phraseStudioIndex.initialize();
});
