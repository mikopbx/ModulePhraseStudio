/* global $, globalTranslate, SoundFilesAPI, UserMessage, sndPlayer */

/**
 * Phrase Studio integration for the SoundFiles modify page.
 *
 * The PHP side (PhraseStudioConf::onVoltBlockCompile) renders our partial
 * inside core's `hookVoltBlock('Fields')`, which lands at the bottom of
 * the form. We move the rendered segment under the upload/record block
 * and wire it to the module's REST API plus the existing convertAudioFile
 * pipeline so the generated WAV becomes the form's source file.
 */
const phraseStudioSoundFiles = {
    api: {
        voices:  '/pbxcore/api/v3/module-phrase-studio/voices',
        phrases: '/pbxcore/api/v3/module-phrase-studio/phrases',
        promote: (id) => `/pbxcore/api/v3/module-phrase-studio/phrases/${id}:promoteToTmp`,
    },

    state: {
        voices: [],
        history: [],
        defaultVoice: '',
        defaultSampleRate: 'native',
    },

    initialize() {
        const $segment = $('#phrase-studio-sf-segment');
        if ($segment.length === 0) {
            return;
        }

        // MOH music files don't fit the TTS use case — hide entirely.
        if (phraseStudioSoundFiles.getCategory() === 'moh') {
            $segment.remove();
            return;
        }

        // Move the segment under the upload/record block.
        const $form = $('#sound-file-form');
        const $sourceSegment = $form.children('.ui.segment').first();
        if ($sourceSegment.length > 0) {
            $segment.insertAfter($sourceSegment);
        }

        $('#phrase-studio-sf-sample-rate').dropdown();
        $('#phrase-studio-sf-text').on('input', phraseStudioSoundFiles.updateCounter);
        $('#phrase-studio-sf-generate').on('click', phraseStudioSoundFiles.onGenerate);

        phraseStudioSoundFiles.loadDefaultsAndVoices();
        phraseStudioSoundFiles.refreshHistory();
    },

    getCategory() {
        const idValue = ($('#id').val() || '').toLowerCase();
        if (idValue === 'moh' || idValue === 'custom') {
            return idValue;
        }
        const formCategory = ($('#category').val() || '').toLowerCase();
        if (formCategory === 'moh' || formCategory === 'custom') {
            return formCategory;
        }
        const urlMatch = window.location.pathname.match(/\/sound-files\/modify\/([a-z]+)/i);
        if (urlMatch && urlMatch[1]) {
            return urlMatch[1].toLowerCase();
        }
        return '';
    },

    updateCounter() {
        const $ta = $('#phrase-studio-sf-text');
        const value = $ta.val() || '';
        const max = parseInt($ta.attr('maxlength') || '800', 10);
        $('#phrase-studio-sf-counter').text(`${value.length} / ${max}`);
    },

    loadDefaultsAndVoices() {
        $.ajax({
            url: phraseStudioSoundFiles.api.voices,
            method: 'GET',
            dataType: 'json',
        }).done((response) => {
            const voices = ((response && response.data) || []).filter((v) => v.installed);
            phraseStudioSoundFiles.state.voices = voices;

            const studioDefaults = window.phraseStudioDefaults || {};
            const fallbackVoice = voices.length > 0 ? voices[0].voice_id : '';
            phraseStudioSoundFiles.state.defaultVoice =
                studioDefaults.voice || fallbackVoice;
            phraseStudioSoundFiles.state.defaultSampleRate =
                studioDefaults.sampleRate || 'native';

            phraseStudioSoundFiles.renderVoices();
        }).fail(() => {
            phraseStudioSoundFiles.disableBlock(
                globalTranslate.module_phrase_studio_ErrorVoicesList || ''
            );
        });
    },

    renderVoices() {
        const $select = $('#phrase-studio-sf-voice').empty();
        const voices = phraseStudioSoundFiles.state.voices;

        if (voices.length === 0) {
            phraseStudioSoundFiles.disableBlock(
                globalTranslate.module_phrase_studio_SoundFilesHookNoVoice
            );
            return;
        }

        const desired = phraseStudioSoundFiles.state.defaultVoice;
        const selectedVoice = voices.some((v) => v.voice_id === desired)
            ? desired
            : voices[0].voice_id;

        voices.forEach((voice) => {
            const label = `${voice.language || ''} — ${voice.voice_name || voice.voice_id}`;
            const $opt = $('<option>')
                .val(voice.voice_id)
                .text(label.trim().replace(/^—\s*/, ''));
            if (voice.voice_id === selectedVoice) {
                $opt.attr('selected', 'selected');
            }
            $select.append($opt);
        });
        $select.val(selectedVoice);

        // Semantic snapshots options at init-time, so we initialise only
        // after the list has been populated.
        $select.dropdown({ fullTextSearch: true });
        $('#phrase-studio-sf-sample-rate')
            .dropdown('set selected', phraseStudioSoundFiles.state.defaultSampleRate);
    },

    refreshHistory() {
        $.ajax({
            url: phraseStudioSoundFiles.api.phrases,
            method: 'GET',
            dataType: 'json',
        }).done((response) => {
            const rows = (response && response.data) || [];
            phraseStudioSoundFiles.state.history = rows;
            phraseStudioSoundFiles.renderHistory();
        });
    },

    renderHistory() {
        const rows = phraseStudioSoundFiles.state.history;
        const $field = $('#phrase-studio-sf-history-field');
        const $select = $('#phrase-studio-sf-history');

        if (rows.length === 0) {
            $field.hide();
            return;
        }
        $field.show();

        // Tear down the dropdown so options can be re-rendered cleanly.
        if ($select.hasClass('ui')) {
            $select.dropdown('destroy');
        }

        $select.off('change.phraseStudio').empty();
        $select.append(
            $('<option>').val('').text(
                globalTranslate.module_phrase_studio_SoundFilesHookHistoryPlaceholder || ''
            )
        );

        rows.forEach((row) => {
            const created = phraseStudioSoundFiles.formatTimestamp(row.created_at);
            const text = (row.text || '').replace(/\s+/g, ' ').trim();
            const snippet = text.length > 60 ? `${text.slice(0, 60)}…` : text;
            const label = `${created} · ${row.voice_id || ''} · ${snippet}`;
            $('<option>').val(String(row.id)).text(label).appendTo($select);
        });

        $select.dropdown({ fullTextSearch: true });
        $select.on('change.phraseStudio', phraseStudioSoundFiles.onHistoryPick);
    },

    formatTimestamp(unix) {
        const ts = parseInt(unix, 10);
        if (!ts || Number.isNaN(ts)) {
            return '';
        }
        const d = new Date(ts * 1000);
        const pad = (n) => (n < 10 ? `0${n}` : `${n}`);
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
            + `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    },

    onHistoryPick() {
        const phraseId = parseInt($('#phrase-studio-sf-history').val() || '0', 10);
        if (!phraseId) {
            return;
        }
        const row = phraseStudioSoundFiles.state.history.find(
            (r) => parseInt(r.id, 10) === phraseId
        );
        if (row) {
            $('#phrase-studio-sf-text').val(row.text || '');
            phraseStudioSoundFiles.updateCounter();
            if (row.voice_id) {
                $('#phrase-studio-sf-voice').dropdown('set selected', row.voice_id);
            }
        }

        const suggestedName = ($('#name').val() || '').trim();
        const $btn = $('#phrase-studio-sf-generate').addClass('loading disabled');
        const $form = $('#sound-file-form').addClass('loading');
        $('#phrase-studio-sf-status').text('');

        phraseStudioSoundFiles.promoteAndConvert(phraseId, suggestedName, $btn, $form);
    },

    disableBlock(message) {
        $('#phrase-studio-sf-text').prop('disabled', true);
        $('#phrase-studio-sf-generate').addClass('disabled');
        if (message) {
            $('#phrase-studio-sf-status').text(message);
        }
    },

    onGenerate() {
        const text = ($('#phrase-studio-sf-text').val() || '').trim();
        const voiceId = $('#phrase-studio-sf-voice').val() || '';
        const sampleRate = $('#phrase-studio-sf-sample-rate').val() || 'native';
        if (!text || !voiceId) {
            UserMessage.showMultiString(
                globalTranslate.module_phrase_studio_ValidationMissing
            );
            return;
        }

        const suggestedName = ($('#name').val() || '').trim();
        const $btn = $('#phrase-studio-sf-generate').addClass('loading disabled');
        const $form = $('#sound-file-form').addClass('loading');
        $('#phrase-studio-sf-status').text('');

        $.ajax({
            url: phraseStudioSoundFiles.api.phrases,
            method: 'POST',
            data: JSON.stringify({ text, voice_id: voiceId, sample_rate: sampleRate }),
            contentType: 'application/json',
            dataType: 'json',
        }).done((response) => {
            const data = response && response.data;
            if (!data || !data.phrase_id) {
                phraseStudioSoundFiles.releaseLoading($btn, $form);
                UserMessage.showMultiString(
                    (response && response.messages)
                        || globalTranslate.module_phrase_studio_ErrorGenerate
                );
                return;
            }
            phraseStudioSoundFiles.promoteAndConvert(
                data.phrase_id, suggestedName, $btn, $form
            );
        }).fail(() => {
            phraseStudioSoundFiles.releaseLoading($btn, $form);
            UserMessage.showMultiString(
                globalTranslate.module_phrase_studio_ErrorGenerate
            );
        });
    },

    promoteAndConvert(phraseId, suggestedName, $btn, $form) {
        const category = $form.form('get value', 'category')
            || $('#category').val()
            || 'custom';

        $.ajax({
            url: phraseStudioSoundFiles.api.promote(phraseId),
            method: 'POST',
            data: JSON.stringify({ name: suggestedName, category }),
            contentType: 'application/json',
            dataType: 'json',
        }).done((response) => {
            // Promote does staging + high-quality conversion in one shot,
            // so we skip SoundFilesAPI.convertAudioFile (it would re-encode
            // at 8 kHz / 16 kbit MP3 and ruin the clean Piper output).
            phraseStudioSoundFiles.onConverted(response, $btn, $form);
        }).fail(() => {
            phraseStudioSoundFiles.releaseLoading($btn, $form);
            UserMessage.showMultiString(
                globalTranslate.module_phrase_studio_ErrorGenerate
            );
        });
    },

    onConverted(response, $btn, $form) {
        phraseStudioSoundFiles.releaseLoading($btn, $form);

        const promoted = response && response.data;
        if (!promoted || !promoted.path) {
            const errorMsg = (response && response.messages && response.messages.error)
                ? [].concat(response.messages.error).join('<br>')
                : globalTranslate.module_phrase_studio_ErrorGenerate;
            UserMessage.showMultiString(errorMsg);
            return;
        }

        const filename = promoted.path;

        if (!($('#name').val() || '').trim() && promoted.basename) {
            $('#name').val(promoted.basename).trigger('change');
        }

        // Push the previous path into core's trashBin (mirrors
        // soundFileModifyRest.cbAfterConvertFile) so the old converted
        // artifact gets unlinked when the form is saved. Skip the very
        // first promote on a new record (no prior path) and avoid pushing
        // the same path twice.
        const previousPath = $form.form('get value', 'path') || '';
        if (previousPath
            && previousPath !== filename
            && typeof window.soundFileModifyRest !== 'undefined'
            && Array.isArray(window.soundFileModifyRest.trashBin)
            && window.soundFileModifyRest.trashBin.indexOf(previousPath) === -1) {
            window.soundFileModifyRest.trashBin.push(previousPath);
        }

        $form.form('set value', 'path', filename);
        $('#name').trigger('change');

        // Reset the player and start playing the freshly converted file.
        //
        // The core ModifySoundPlayer caches the previous take in
        // `html5Audio.src` (a blob URL). Its `play()` short-circuits when it
        // sees a cached blob and replays the previous generation. We bypass
        // that path by clearing the cached blob, updating the source for the
        // segment chrome, and then calling `loadAuthenticatedSource()`
        // directly so a brand-new blob is fetched + auto-played each time.
        if (typeof sndPlayer !== 'undefined' && sndPlayer && sndPlayer.html5Audio) {
            const newUrl = `/pbxcore/api/v3/sound-files:playback?view=${filename}`;
            try {
                sndPlayer.html5Audio.pause();
                if (sndPlayer.html5Audio.src
                    && sndPlayer.html5Audio.src.startsWith('blob:')) {
                    URL.revokeObjectURL(sndPlayer.html5Audio.src);
                }
                sndPlayer.html5Audio.removeAttribute('src');
                sndPlayer.html5Audio.load();
            } catch (e) {
                // Best-effort reset — failures are non-fatal.
            }
            if (typeof sndPlayer.UpdateSource === 'function') {
                sndPlayer.UpdateSource(newUrl);
            }
            if (typeof sndPlayer.loadAuthenticatedSource === 'function') {
                sndPlayer.loadAuthenticatedSource(newUrl);
            } else if (typeof sndPlayer.play === 'function') {
                sndPlayer.play();
            }
        }

        // Refresh history so the freshly generated phrase shows up in the
        // dropdown immediately and stays in sync after repeat generations.
        phraseStudioSoundFiles.refreshHistory();
    },

    releaseLoading($btn, $form) {
        $btn.removeClass('loading disabled');
        $form.removeClass('loading');
    },
};

$(document).ready(() => {
    phraseStudioSoundFiles.initialize();
});
