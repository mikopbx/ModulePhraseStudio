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
        // voice_id → { startedAt, attempts, timer } for installs in flight.
        // Tracking attempts client-side lets us cap polling at ~10 minutes
        // even if the worker silently dies, instead of spinning forever.
        installPolls: {},
    },

    // Voice install polling: 3-second tick × 500 attempts ≈ 25 minutes.
    // The detached `install-voice.php` runner uses `curl --max-time 600`
    // per asset (×2 files = 20-minute hard backend ceiling). The poll cap
    // must sit ABOVE that ceiling — otherwise a slow-but-still-running
    // download is mistaken for a crash, the JS bails, and the user is left
    // with a stuck UI even though the worker is still writing the file.
    // Beyond 25 minutes we hand recovery off to the server-side sweeper
    // (30 min, GetListAction::sweepStaleInstalls), which flips the row to
    // `failed` and the next refresh shows the standard Retry button.
    INSTALL_POLL_INTERVAL_MS: 3000,
    INSTALL_POLL_MAX_ATTEMPTS: 500,

    initialize() {
        $('#phrase-studio-tab-menu .item').tab();
        $('#phrase-studio-remember-checkbox').checkbox();
        $('#phrase-studio-sample-rate').dropdown();

        // Module disabled → page is read-only, skip REST polling and
        // disable the form inputs. Avoids the "failed to load voices"
        // error popup users got when opening a disabled module's page.
        if ((window.phraseStudioDefaults || {}).disabled) {
            $('#phrase-studio-generate-form :input,'
                + '#phrase-studio-generate-button').prop('disabled', true);
            return;
        }

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
            // Once the binary is on disk we offer "Update engine" instead of
            // an Uninstall — re-running install() overwrites the tarball with
            // the pinned RELEASE_VERSION (or whatever the catalog now points
            // at), so the same button doubles as a refresh path. Removing the
            // Uninstall button from the UI is intentional: users wanted a
            // refresh, not a wipe; full removal still works via DELETE /engine
            // for anyone scripting against the API.
            $box.append(
                $('<div>').addClass('ui positive message')
                    .append($('<div>').addClass('header').text(globalTranslate.module_phrase_studio_EngineInstalled))
                    .append($('<p>').text(`${globalTranslate.module_phrase_studio_EngineVersion}: ${data.version || '—'}`))
                    .append(
                        $('<button>')
                            .addClass('ui small basic button')
                            .text(globalTranslate.module_phrase_studio_EngineUpdate)
                            // Update path posts {force: true} so the action
                            // bypasses its `isInstalled()` shortcut and actually
                            // re-downloads the pinned RELEASE_VERSION. Without
                            // the flag the click would be a no-op once the
                            // engine is already on disk.
                            .on('click', phraseStudioIndex.onEngineUpdate)
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
        phraseStudioIndex.dispatchEngineInstall($(this), false);
    },

    onEngineUpdate() {
        phraseStudioIndex.dispatchEngineInstall($(this), true);
    },

    dispatchEngineInstall($btn, force) {
        $btn.addClass('loading disabled');
        $.ajax({
            url: phraseStudioIndex.api.engineInstall,
            method: 'POST',
            // POST body is required for `force` to land on the action's
            // $data array; the action runs `filter_var(..., FILTER_VALIDATE_BOOLEAN)`
            // so the JSON literal `true` arrives as PHP true, not "1".
            data: JSON.stringify({force: !!force}),
            contentType: 'application/json',
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

    /** Stash for the most recent history payload so we can re-render it
     *  once the voices catalogue arrives (race-fix: refreshVoices and
     *  refreshHistory fire in parallel on init; when history wins first
     *  the rows render with raw voice_ids until voices catch up).
     */
    lastHistoryRows: [],

    refreshVoices() {
        $.ajax({
            url: phraseStudioIndex.api.voices,
            method: 'GET',
            dataType: 'json',
        }).done((response) => {
            phraseStudioIndex.state.voices = (response && response.data) || [];
            phraseStudioIndex.renderVoicesTable();
            phraseStudioIndex.renderVoicePicker();
            // If history already painted with raw voice_ids (parallel init
            // race), repaint now that we have the catalogue for flag lookup.
            if (phraseStudioIndex.lastHistoryRows.length > 0) {
                phraseStudioIndex.renderHistory(phraseStudioIndex.lastHistoryRows);
            }
        }).fail(() => {
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorVoicesList);
        });
    },

    /**
     * Translates a Piper language tag (e.g. 'ru-ru', 'en-us', 'pt-br')
     * into a Semantic UI flag class. The second segment is already an
     * ISO 3166-1 alpha-2 country code in the catalogue, so we just
     * extract and lowercase it. Unknown tags fall back to no flag.
     */
    flagClassFor(language) {
        if (!language) return '';
        const parts = String(language).toLowerCase().split('-');
        const cc = parts[parts.length - 1];
        if (!cc || cc.length !== 2) return '';
        return cc;
    },

    renderVoicesTable() {
        const $tbody = $('#phrase-studio-voices-table tbody').empty();
        phraseStudioIndex.state.voices.forEach((voice) => {
            const $row = $('<tr>').attr('data-voice', voice.voice_id);
            const flag = phraseStudioIndex.flagClassFor(voice.language);
            const $lang = $('<td>');
            if (flag) {
                $lang.append(`<i class="${flag} flag"></i>`);
            }
            $lang.append(document.createTextNode(`${voice.language_label} (${voice.language})`));
            $row.append($lang);
            $row.append($('<td>').text(voice.voice_name));
            $row.append($('<td>').text(voice.quality));
            $row.append($('<td>').text(`${voice.sample_rate} Hz`));

            const status = voice.install_status || (voice.installed ? 'installed' : '');
            const $statusCell = $('<td>');
            if (status === 'installed') {
                $statusCell.html(`<span class="ui green label">${globalTranslate.module_phrase_studio_VoiceInstalled}</span>`);
            } else if (status === 'installing') {
                $statusCell.html(
                    '<div class="ui active inline mini loader"></div> '
                    + `<span class="ui yellow label">${globalTranslate.module_phrase_studio_VoiceInstalling}</span>`
                );
            } else if (status === 'failed') {
                const err = voice.install_error || '';
                $statusCell.html(
                    `<span class="ui red label" title="${$('<div>').text(err).html()}">`
                    + `${globalTranslate.module_phrase_studio_VoiceFailed}</span>`
                );
            } else {
                $statusCell.html(`<span class="ui label">${globalTranslate.module_phrase_studio_VoiceNotInstalled}</span>`);
            }
            $row.append($statusCell);

            const $actions = $('<td>').addClass('right aligned');
            if (status === 'installed') {
                $actions.append(
                    $('<button>').addClass('ui small basic red icon button')
                        .attr('data-voice', voice.voice_id)
                        .attr('title', globalTranslate.module_phrase_studio_VoiceDelete)
                        .append('<i class="trash icon"></i>')
                        .on('click', phraseStudioIndex.onVoiceUninstall)
                );
            } else if (status === 'installing') {
                // While the worker is downloading we lock the action cell —
                // showing a disabled spinner makes the in-flight state read
                // clearly and prevents double-publish on impatient clicks.
                $actions.append(
                    $('<button>').addClass('ui small primary icon button loading disabled')
                        .attr('data-voice', voice.voice_id)
                        .attr('title', globalTranslate.module_phrase_studio_VoiceInstalling)
                        .append('<i class="download icon"></i>')
                );
            } else {
                // 'failed' and not-installed share the same action button —
                // both result in publishing a fresh install_voice job.
                const label = status === 'failed'
                    ? globalTranslate.module_phrase_studio_VoiceRetry
                    : globalTranslate.module_phrase_studio_VoiceInstall;
                $actions.append(
                    $('<button>').addClass('ui small primary icon button')
                        .attr('data-voice', voice.voice_id)
                        .attr('title', label)
                        .append('<i class="download icon"></i>')
                        .on('click', phraseStudioIndex.onVoiceInstall)
                );
            }
            $row.append($actions);
            $tbody.append($row);
        });

        // Re-arm polling for any voice the server still reports as
        // 'installing' (covers page reloads mid-install).
        phraseStudioIndex.state.voices
            .filter((v) => v.install_status === 'installing')
            .forEach((v) => phraseStudioIndex.scheduleInstallPoll(v.voice_id));
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
                const flag = phraseStudioIndex.flagClassFor(voice.language);
                // Semantic UI dropdown reads `data-text` for the display string
                // and renders a flag from `data-flag` when present, so the chosen
                // option keeps the icon after selection.
                const $opt = $('<option>')
                    .val(voice.voice_id)
                    .text(`${voice.language_label} — ${voice.voice_name} (${voice.quality})`);
                if (flag) {
                    $opt.attr('data-flag', flag);
                }
                $select.append($opt);
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
        // Lock the button immediately so impatient double-clicks can't queue
        // a duplicate install. The button stays disabled until refreshVoices
        // re-renders the row from the new install_status.
        $btn.addClass('loading disabled');
        $.ajax({
            url: phraseStudioIndex.api.voiceInstall,
            method: 'POST',
            data: JSON.stringify({voice_id: voiceId}),
            contentType: 'application/json',
            dataType: 'json',
        }).done((response) => {
            if (response && response.result === false) {
                $btn.removeClass('loading disabled');
                UserMessage.showMultiString(response.messages
                    || globalTranslate.module_phrase_studio_ErrorVoiceInstall);
                return;
            }
            // Backend returns 202 with install_status='installing' before the
            // worker actually runs curl. The row spinner + "Downloading…" label
            // and the disabled action button already convey the in-flight state
            // — no toast needed.
            phraseStudioIndex.refreshVoices();
            phraseStudioIndex.scheduleInstallPoll(voiceId);
        }).fail(() => {
            $btn.removeClass('loading disabled');
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorVoiceInstall);
        });
    },

    /**
     * Polls GET /voices for the given voice_id until install_status flips
     * out of 'installing'. Re-entrant: scheduling the same voice while a
     * timer is already pending is a no-op (covers double-renders triggered
     * by tab switches and concurrent refreshVoices calls).
     */
    scheduleInstallPoll(voiceId) {
        const polls = phraseStudioIndex.state.installPolls;
        if (polls[voiceId]) return;
        polls[voiceId] = {startedAt: Date.now(), attempts: 0};
        polls[voiceId].timer = setInterval(
            () => phraseStudioIndex.tickInstallPoll(voiceId),
            phraseStudioIndex.INSTALL_POLL_INTERVAL_MS
        );
    },

    cancelInstallPoll(voiceId) {
        const entry = phraseStudioIndex.state.installPolls[voiceId];
        if (!entry) return;
        clearInterval(entry.timer);
        delete phraseStudioIndex.state.installPolls[voiceId];
    },

    tickInstallPoll(voiceId) {
        const entry = phraseStudioIndex.state.installPolls[voiceId];
        if (!entry) return;
        entry.attempts += 1;
        if (entry.attempts > phraseStudioIndex.INSTALL_POLL_MAX_ATTEMPTS) {
            phraseStudioIndex.cancelInstallPoll(voiceId);
            // We deliberately do NOT DELETE the row here: the cap is set
            // above the backend's worst-case curl window, but a genuinely
            // slow install can still be writing files. Yanking the row
            // would race with the worker's final save (orphan .onnx) and
            // erase a real success a few seconds before it lands. Just
            // surface a hint and let the server-side sweeper (30 min,
            // GetListAction::sweepStaleInstalls) flip the row to `failed`
            // if the download actually died — the UI then shows Retry.
            UserMessage.showMultiString(globalTranslate.module_phrase_studio_VoiceInstallTimeout);
            return;
        }
        $.ajax({
            url: phraseStudioIndex.api.voices,
            method: 'GET',
            dataType: 'json',
        }).done((response) => {
            const list = (response && response.data) || [];
            phraseStudioIndex.state.voices = list;
            phraseStudioIndex.renderVoicesTable();
            phraseStudioIndex.renderVoicePicker();
            const voice = list.find((v) => v.voice_id === voiceId);
            if (!voice) {
                // Row vanished (user pressed Remove mid-install): drop the timer.
                phraseStudioIndex.cancelInstallPoll(voiceId);
                return;
            }
            if (voice.install_status === 'installed') {
                phraseStudioIndex.cancelInstallPoll(voiceId);
                // No toast — the row already turned green with the new status
                // and the action button became Remove. Failures still toast,
                // because install_error needs surfacing somewhere.
                return;
            }
            if (voice.install_status === 'failed') {
                phraseStudioIndex.cancelInstallPoll(voiceId);
                const detail = voice.install_error
                    ? `${globalTranslate.module_phrase_studio_ErrorVoiceInstall} ${voice.install_error}`
                    : globalTranslate.module_phrase_studio_ErrorVoiceInstall;
                UserMessage.showMultiString(detail);
                return;
            }
            // status === 'installing' → keep ticking
        });
    },

    onVoiceUninstall() {
        const $btn = $(this);
        const voiceId = $btn.data('voice');
        $btn.addClass('loading disabled');
        // Cancel any in-flight install poll for this voice — Remove on a
        // 'failed' or 'installing' row should clear the placeholder cleanly.
        phraseStudioIndex.cancelInstallPoll(voiceId);
        $.ajax({
            url: `${phraseStudioIndex.api.voices}/${encodeURIComponent(voiceId)}`,
            method: 'DELETE',
            dataType: 'json',
        }).done(() => {
            // No toast — the row reverts to the not-installed label and shows
            // an Install button, which is enough confirmation for a delete.
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
            // History table lives right under the form on the Studio tab,
            // so a refresh is enough — no tab switch.
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

    refreshHistory(callback) {
        $.ajax({
            url: phraseStudioIndex.api.phrases,
            method: 'GET',
            dataType: 'json',
        }).done((response) => {
            const rows = (response && response.data) || [];
            phraseStudioIndex.lastHistoryRows = rows;
            phraseStudioIndex.renderHistory(rows);
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

        const $tableWrap = $('#phrase-studio-history-table').closest('.dataTables_wrapper');
        if (rows.length === 0) {
            $('#phrase-studio-history-table').hide();
            ($tableWrap.length ? $tableWrap : $('#phrase-studio-history-table')).hide();
            $('#phrase-studio-history-empty').show();
            return;
        }
        $('#phrase-studio-history-empty').hide();
        $('#phrase-studio-history-table').show();
        if ($tableWrap.length) {
            $tableWrap.show();
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

        // Standard MikoPBX two-step delete (delete-something.js) flips the
        // 'two-steps-delete' class off on the first click. We listen for the
        // *second* click (when the class is gone) to fire the REST DELETE.
        $('body').off('click.phraseStudio');
        $('body').on('click.phraseStudio', 'a.delete:not(.two-steps-delete)', function onConfirmedDelete(e) {
            const $target = $(e.target).closest('a.delete');
            if ($target.closest('#phrase-studio-history-table').length === 0) {
                return;
            }
            e.preventDefault();
            e.stopImmediatePropagation();
            const id = $target.attr('data-value');
            if (!id) return;
            $target.addClass('loading disabled');
            $.ajax({
                url: `${phraseStudioIndex.api.phrases}/${id}`,
                method: 'DELETE',
                dataType: 'json',
            }).done(() => phraseStudioIndex.refreshHistory())
              .fail(() => {
                  $target.removeClass('loading disabled');
                  UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorHistoryDelete);
              });
        });
        const $tbl = $('#phrase-studio-history-table');
        $tbl.find('.popuped').popup();
        // Click on the text cell → copy phrase text + voice back into the form
        // so the user can edit and re-generate without retyping. Keeps the
        // player / download / delete buttons clickable on their own.
        $tbl.off('click.phraseStudio');
        $tbl.on('click.phraseStudio', 'td.phrase-reuse', function onReuse() {
            const $row = $(this).closest('tr');
            const text = $row.attr('data-text') || '';
            const voice = $row.attr('data-voice') || '';
            $('#phrase-studio-text').val(text).trigger('input');
            if (voice) {
                $('#phrase-studio-voice').dropdown('set selected', voice);
            }
            $('html, body').animate({scrollTop: $('#phrase-studio-text').offset().top - 80}, 200);
            $('#phrase-studio-text').focus();
        });
    },

    /**
     * Resolves a phrase row's voice_id into a "🇷🇺 Irina (medium)" string with
     * the matching Semantic UI flag. Falls back to the raw voice_id when the
     * voice is not in the loaded catalogue (e.g. user removed the voice but
     * the phrase row from before is still in history).
     */
    formatVoiceLabel(voiceId) {
        const escAttr = (s) => $('<div>').text(s).html().replace(/"/g, '&quot;');
        if (!voiceId) return '<span class="ui label">—</span>';
        const voice = phraseStudioIndex.state.voices.find((v) => v.voice_id === voiceId);
        if (!voice) {
            // Voice no longer installed — keep raw id so the user can
            // identify which historic phrase used what model.
            return $('<div>').text(voiceId).html();
        }
        const flag = phraseStudioIndex.flagClassFor(voice.language);
        const flagHtml = flag ? `<i class="${flag} flag" title="${escAttr(voice.language_label)}"></i>` : '';
        const label = `${voice.voice_name} (${voice.quality})`;
        return `${flagHtml}${$('<div>').text(label).html()}`;
    },

    renderHistoryRow(row) {
        const created   = row.created_at ? new Date(row.created_at * 1000).toLocaleString() : '—';
        const fullText  = row.text || '';
        const shortText = fullText.length > 80 ? `${fullText.substring(0, 80)}…` : fullText;
        const voiceId   = row.voice_id || '';
        const playUrl   = `${phraseStudioIndex.api.phrases}/${row.id}:download`;
        const dlUrl     = playUrl;
        const filename  = `phrase_${row.id}.wav`;
        const tooltip   = globalTranslate.module_phrase_studio_RowReuseTooltip || '';
        const escAttr   = (s) => $('<div>').text(s).html().replace(/"/g, '&quot;');
        return `<tr class="file-row" id="phrase-row-${row.id}"
                    data-value="${playUrl}"
                    data-text="${escAttr(fullText)}"
                    data-voice="${escAttr(voiceId)}">
            <td>${$('<div>').text(created).html()}</td>
            <td class="phrase-reuse" style="cursor:pointer" title="${escAttr(tooltip)}">
                <i class="file audio outline icon"></i>${$('<div>').text(shortText).html()}
            </td>
            <td>${phraseStudioIndex.formatVoiceLabel(voiceId)}</td>
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
                    <a href="#" data-value="${row.id}"
                       class="ui button delete two-steps-delete popuped"
                       data-content="${escAttr(globalTranslate.module_phrase_studio_HistoryDelete)}">
                        <i class="icon trash red"></i>
                    </a>
                </div>
            </td>
        </tr>`;
    },
};

$(document).ready(() => {
    phraseStudioIndex.initialize();
});
