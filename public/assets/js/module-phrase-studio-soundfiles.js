"use strict";

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
var phraseStudioSoundFiles = {
  api: {
    voices: '/pbxcore/api/v3/module-phrase-studio/voices',
    phrases: '/pbxcore/api/v3/module-phrase-studio/phrases',
    promote: function promote(id) {
      return "/pbxcore/api/v3/module-phrase-studio/phrases/".concat(id, ":promoteToTmp");
    }
  },
  state: {
    voices: [],
    history: [],
    defaultVoice: '',
    defaultSampleRate: 'native'
  },
  initialize: function initialize() {
    var $segment = $('#phrase-studio-sf-segment');

    if ($segment.length === 0) {
      return;
    } // MOH music files don't fit the TTS use case — hide entirely.


    if (phraseStudioSoundFiles.getCategory() === 'moh') {
      $segment.remove();
      return;
    } // Move the segment under the upload/record block.


    var $form = $('#sound-file-form');
    var $sourceSegment = $form.children('.ui.segment').first();

    if ($sourceSegment.length > 0) {
      $segment.insertAfter($sourceSegment);
    }

    $('#phrase-studio-sf-sample-rate').dropdown();
    $('#phrase-studio-sf-text').on('input', phraseStudioSoundFiles.updateCounter);
    $('#phrase-studio-sf-generate').on('click', phraseStudioSoundFiles.onGenerate);
    phraseStudioSoundFiles.loadDefaultsAndVoices();
    phraseStudioSoundFiles.refreshHistory();
  },
  getCategory: function getCategory() {
    var idValue = ($('#id').val() || '').toLowerCase();

    if (idValue === 'moh' || idValue === 'custom') {
      return idValue;
    }

    var formCategory = ($('#category').val() || '').toLowerCase();

    if (formCategory === 'moh' || formCategory === 'custom') {
      return formCategory;
    }

    var urlMatch = window.location.pathname.match(/\/sound-files\/modify\/([a-z]+)/i);

    if (urlMatch && urlMatch[1]) {
      return urlMatch[1].toLowerCase();
    }

    return '';
  },
  updateCounter: function updateCounter() {
    var $ta = $('#phrase-studio-sf-text');
    var value = $ta.val() || '';
    var max = parseInt($ta.attr('maxlength') || '800', 10);
    $('#phrase-studio-sf-counter').text("".concat(value.length, " / ").concat(max));
  },
  loadDefaultsAndVoices: function loadDefaultsAndVoices() {
    $.ajax({
      url: phraseStudioSoundFiles.api.voices,
      method: 'GET',
      dataType: 'json'
    }).done(function (response) {
      var voices = (response && response.data || []).filter(function (v) {
        return v.installed;
      });
      phraseStudioSoundFiles.state.voices = voices;
      var studioDefaults = window.phraseStudioDefaults || {};
      var fallbackVoice = voices.length > 0 ? voices[0].voice_id : '';
      phraseStudioSoundFiles.state.defaultVoice = studioDefaults.voice || fallbackVoice;
      phraseStudioSoundFiles.state.defaultSampleRate = studioDefaults.sampleRate || 'native';
      phraseStudioSoundFiles.renderVoices();
    }).fail(function () {
      phraseStudioSoundFiles.disableBlock(globalTranslate.module_phrase_studio_ErrorVoicesList || '');
    });
  },
  renderVoices: function renderVoices() {
    var $select = $('#phrase-studio-sf-voice').empty();
    var voices = phraseStudioSoundFiles.state.voices;

    if (voices.length === 0) {
      phraseStudioSoundFiles.disableBlock(globalTranslate.module_phrase_studio_SoundFilesHookNoVoice);
      return;
    }

    var desired = phraseStudioSoundFiles.state.defaultVoice;
    var selectedVoice = voices.some(function (v) {
      return v.voice_id === desired;
    }) ? desired : voices[0].voice_id;
    voices.forEach(function (voice) {
      var label = "".concat(voice.language || '', " \u2014 ").concat(voice.voice_name || voice.voice_id);
      var $opt = $('<option>').val(voice.voice_id).text(label.trim().replace(/^—\s*/, ''));

      if (voice.voice_id === selectedVoice) {
        $opt.attr('selected', 'selected');
      }

      $select.append($opt);
    });
    $select.val(selectedVoice); // Semantic snapshots options at init-time, so we initialise only
    // after the list has been populated.

    $select.dropdown({
      fullTextSearch: true
    });
    $('#phrase-studio-sf-sample-rate').dropdown('set selected', phraseStudioSoundFiles.state.defaultSampleRate);
  },
  refreshHistory: function refreshHistory() {
    $.ajax({
      url: phraseStudioSoundFiles.api.phrases,
      method: 'GET',
      dataType: 'json'
    }).done(function (response) {
      var rows = response && response.data || [];
      phraseStudioSoundFiles.state.history = rows;
      phraseStudioSoundFiles.renderHistory();
    });
  },
  renderHistory: function renderHistory() {
    var rows = phraseStudioSoundFiles.state.history;
    var $field = $('#phrase-studio-sf-history-field');
    var $select = $('#phrase-studio-sf-history');

    if (rows.length === 0) {
      $field.hide();
      return;
    }

    $field.show(); // Tear down the dropdown so options can be re-rendered cleanly.

    if ($select.hasClass('ui')) {
      $select.dropdown('destroy');
    }

    $select.off('change.phraseStudio').empty();
    $select.append($('<option>').val('').text(globalTranslate.module_phrase_studio_SoundFilesHookHistoryPlaceholder || ''));
    rows.forEach(function (row) {
      var created = phraseStudioSoundFiles.formatTimestamp(row.created_at);
      var text = (row.text || '').replace(/\s+/g, ' ').trim();
      var snippet = text.length > 60 ? "".concat(text.slice(0, 60), "\u2026") : text;
      var label = "".concat(created, " \xB7 ").concat(row.voice_id || '', " \xB7 ").concat(snippet);
      $('<option>').val(String(row.id)).text(label).appendTo($select);
    });
    $select.dropdown({
      fullTextSearch: true
    });
    $select.on('change.phraseStudio', phraseStudioSoundFiles.onHistoryPick);
  },
  formatTimestamp: function formatTimestamp(unix) {
    var ts = parseInt(unix, 10);

    if (!ts || Number.isNaN(ts)) {
      return '';
    }

    var d = new Date(ts * 1000);

    var pad = function pad(n) {
      return n < 10 ? "0".concat(n) : "".concat(n);
    };

    return "".concat(d.getFullYear(), "-").concat(pad(d.getMonth() + 1), "-").concat(pad(d.getDate()), " ") + "".concat(pad(d.getHours()), ":").concat(pad(d.getMinutes()));
  },
  onHistoryPick: function onHistoryPick() {
    var phraseId = parseInt($('#phrase-studio-sf-history').val() || '0', 10);

    if (!phraseId) {
      return;
    }

    var row = phraseStudioSoundFiles.state.history.find(function (r) {
      return parseInt(r.id, 10) === phraseId;
    });

    if (row) {
      $('#phrase-studio-sf-text').val(row.text || '');
      phraseStudioSoundFiles.updateCounter();

      if (row.voice_id) {
        $('#phrase-studio-sf-voice').dropdown('set selected', row.voice_id);
      }
    }

    var suggestedName = ($('#name').val() || '').trim();
    var $btn = $('#phrase-studio-sf-generate').addClass('loading disabled');
    var $form = $('#sound-file-form').addClass('loading');
    $('#phrase-studio-sf-status').text('');
    phraseStudioSoundFiles.promoteAndConvert(phraseId, suggestedName, $btn, $form);
  },
  disableBlock: function disableBlock(message) {
    $('#phrase-studio-sf-text').prop('disabled', true);
    $('#phrase-studio-sf-generate').addClass('disabled');

    if (message) {
      $('#phrase-studio-sf-status').text(message);
    }
  },
  onGenerate: function onGenerate() {
    var text = ($('#phrase-studio-sf-text').val() || '').trim();
    var voiceId = $('#phrase-studio-sf-voice').val() || '';
    var sampleRate = $('#phrase-studio-sf-sample-rate').val() || 'native';

    if (!text || !voiceId) {
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ValidationMissing);
      return;
    }

    var suggestedName = ($('#name').val() || '').trim();
    var $btn = $('#phrase-studio-sf-generate').addClass('loading disabled');
    var $form = $('#sound-file-form').addClass('loading');
    $('#phrase-studio-sf-status').text('');
    $.ajax({
      url: phraseStudioSoundFiles.api.phrases,
      method: 'POST',
      data: JSON.stringify({
        text: text,
        voice_id: voiceId,
        sample_rate: sampleRate
      }),
      contentType: 'application/json',
      dataType: 'json'
    }).done(function (response) {
      var data = response && response.data;

      if (!data || !data.phrase_id) {
        phraseStudioSoundFiles.releaseLoading($btn, $form);
        UserMessage.showMultiString(response && response.messages || globalTranslate.module_phrase_studio_ErrorGenerate);
        return;
      }

      phraseStudioSoundFiles.promoteAndConvert(data.phrase_id, suggestedName, $btn, $form);
    }).fail(function () {
      phraseStudioSoundFiles.releaseLoading($btn, $form);
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorGenerate);
    });
  },
  promoteAndConvert: function promoteAndConvert(phraseId, suggestedName, $btn, $form) {
    var category = $form.form('get value', 'category') || $('#category').val() || 'custom';
    $.ajax({
      url: phraseStudioSoundFiles.api.promote(phraseId),
      method: 'POST',
      data: JSON.stringify({
        name: suggestedName,
        category: category
      }),
      contentType: 'application/json',
      dataType: 'json'
    }).done(function (response) {
      // Promote does staging + high-quality conversion in one shot,
      // so we skip SoundFilesAPI.convertAudioFile (it would re-encode
      // at 8 kHz / 16 kbit MP3 and ruin the clean Piper output).
      phraseStudioSoundFiles.onConverted(response, $btn, $form);
    }).fail(function () {
      phraseStudioSoundFiles.releaseLoading($btn, $form);
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorGenerate);
    });
  },
  onConverted: function onConverted(response, $btn, $form) {
    phraseStudioSoundFiles.releaseLoading($btn, $form);
    var promoted = response && response.data;

    if (!promoted || !promoted.path) {
      var errorMsg = response && response.messages && response.messages.error ? [].concat(response.messages.error).join('<br>') : globalTranslate.module_phrase_studio_ErrorGenerate;
      UserMessage.showMultiString(errorMsg);
      return;
    }

    var filename = promoted.path;

    if (!($('#name').val() || '').trim() && promoted.basename) {
      $('#name').val(promoted.basename).trigger('change');
    } // Push the previous path into core's trashBin (mirrors
    // soundFileModifyRest.cbAfterConvertFile) so the old converted
    // artifact gets unlinked when the form is saved. Skip the very
    // first promote on a new record (no prior path) and avoid pushing
    // the same path twice.


    var previousPath = $form.form('get value', 'path') || '';

    if (previousPath && previousPath !== filename && typeof window.soundFileModifyRest !== 'undefined' && Array.isArray(window.soundFileModifyRest.trashBin) && window.soundFileModifyRest.trashBin.indexOf(previousPath) === -1) {
      window.soundFileModifyRest.trashBin.push(previousPath);
    }

    $form.form('set value', 'path', filename);
    $('#name').trigger('change'); // Reset the player and start playing the freshly converted file.
    //
    // The core ModifySoundPlayer caches the previous take in
    // `html5Audio.src` (a blob URL). Its `play()` short-circuits when it
    // sees a cached blob and replays the previous generation. We bypass
    // that path by clearing the cached blob, updating the source for the
    // segment chrome, and then calling `loadAuthenticatedSource()`
    // directly so a brand-new blob is fetched + auto-played each time.

    if (typeof sndPlayer !== 'undefined' && sndPlayer && sndPlayer.html5Audio) {
      var newUrl = "/pbxcore/api/v3/sound-files:playback?view=".concat(filename);

      try {
        sndPlayer.html5Audio.pause();

        if (sndPlayer.html5Audio.src && sndPlayer.html5Audio.src.startsWith('blob:')) {
          URL.revokeObjectURL(sndPlayer.html5Audio.src);
        }

        sndPlayer.html5Audio.removeAttribute('src');
        sndPlayer.html5Audio.load();
      } catch (e) {// Best-effort reset — failures are non-fatal.
      }

      if (typeof sndPlayer.UpdateSource === 'function') {
        sndPlayer.UpdateSource(newUrl);
      }

      if (typeof sndPlayer.loadAuthenticatedSource === 'function') {
        sndPlayer.loadAuthenticatedSource(newUrl);
      } else if (typeof sndPlayer.play === 'function') {
        sndPlayer.play();
      }
    } // Refresh history so the freshly generated phrase shows up in the
    // dropdown immediately and stays in sync after repeat generations.


    phraseStudioSoundFiles.refreshHistory();
  },
  releaseLoading: function releaseLoading($btn, $form) {
    $btn.removeClass('loading disabled');
    $form.removeClass('loading');
  }
};
$(document).ready(function () {
  phraseStudioSoundFiles.initialize();
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNyYy9tb2R1bGUtcGhyYXNlLXN0dWRpby1zb3VuZGZpbGVzLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7O0FBQUE7O0FBRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBTSxzQkFBc0IsR0FBRztBQUMzQixFQUFBLEdBQUcsRUFBRTtBQUNELElBQUEsTUFBTSxFQUFHLDZDQURSO0FBRUQsSUFBQSxPQUFPLEVBQUUsOENBRlI7QUFHRCxJQUFBLE9BQU8sRUFBRSxpQkFBQyxFQUFEO0FBQUEsb0VBQXdELEVBQXhEO0FBQUE7QUFIUixHQURzQjtBQU8zQixFQUFBLEtBQUssRUFBRTtBQUNILElBQUEsTUFBTSxFQUFFLEVBREw7QUFFSCxJQUFBLE9BQU8sRUFBRSxFQUZOO0FBR0gsSUFBQSxZQUFZLEVBQUUsRUFIWDtBQUlILElBQUEsaUJBQWlCLEVBQUU7QUFKaEIsR0FQb0I7QUFjM0IsRUFBQSxVQWQyQix3QkFjZDtBQUNULFFBQU0sUUFBUSxHQUFHLENBQUMsQ0FBQywyQkFBRCxDQUFsQjs7QUFDQSxRQUFJLFFBQVEsQ0FBQyxNQUFULEtBQW9CLENBQXhCLEVBQTJCO0FBQ3ZCO0FBQ0gsS0FKUSxDQU1UOzs7QUFDQSxRQUFJLHNCQUFzQixDQUFDLFdBQXZCLE9BQXlDLEtBQTdDLEVBQW9EO0FBQ2hELE1BQUEsUUFBUSxDQUFDLE1BQVQ7QUFDQTtBQUNILEtBVlEsQ0FZVDs7O0FBQ0EsUUFBTSxLQUFLLEdBQUcsQ0FBQyxDQUFDLGtCQUFELENBQWY7QUFDQSxRQUFNLGNBQWMsR0FBRyxLQUFLLENBQUMsUUFBTixDQUFlLGFBQWYsRUFBOEIsS0FBOUIsRUFBdkI7O0FBQ0EsUUFBSSxjQUFjLENBQUMsTUFBZixHQUF3QixDQUE1QixFQUErQjtBQUMzQixNQUFBLFFBQVEsQ0FBQyxXQUFULENBQXFCLGNBQXJCO0FBQ0g7O0FBRUQsSUFBQSxDQUFDLENBQUMsK0JBQUQsQ0FBRCxDQUFtQyxRQUFuQztBQUNBLElB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QUFBLEdBQUcsQ0FBQyxlQUFKLENBQW9CLFNBQVMsQ0FBQyxVQUFWLENBQXFCLEdBQXpDO0FBQ0g7O0FBQ0QsUUFBQSxTQUFTLENBQUMsVUFBVixDQUFxQixlQUFyQixDQUFxQyxLQUFyQztBQUNBLFFBQUEsU0FBUyxDQUFDLFVBQVYsQ0FBcUIsSUFBckI7QUFDSCxPQVJELENBUUUsT0FBTyxDQUFQLEVBQVUsQ0FDUjtBQUNIOztBQUNELFVBQUksT0FBTyxTQUFTLENBQUMsWUFBakIsS0FBa0MsVUFBdEMsRUFBa0Q7QUFDOUMsUUFBQSxTQUFTLENBQUMsWUFBVixDQUF1QixNQUF2QjtBQUNIOztBQUNELFVBQUksT0FBTyxTQUFTLENBQUMsdUJBQWpCLEtBQTZDLFVBQWpELEVBQTZEO0FBQ3pELFFBQUEsU0FBUyxDQUFDLHVCQUFWLENBQWtDLE1BQWxDO0FBQ0gsT0FGRCxNQUVPLElBQUksT0FBTyxTQUFTLENBQUMsSUFBakIsS0FBMEIsVUFBOUIsRUFBMEM7QUFDN0MsUUFBQSxTQUFTLENBQUMsSUFBVjtBQUNIO0FBQ0osS0FoRThCLENBa0UvQjtBQUNBOzs7QUFDQSxJQUFBLHNCQUFzQixDQUFDLGNBQXZCO0FBQ0gsR0E3VjBCO0FBK1YzQixFQUFBLGNBL1YyQiwwQkErVlosSUEvVlksRUErVk4sS0EvVk0sRUErVkM7QUFDeEIsSUFBQSxJQUFJLENBQUMsV0FBTCxDQUFpQixrQkFBakI7QUFDQSxJQUFBLEtBQUssQ0FBQyxXQUFOLENBQWtCLFNBQWxCO0FBQ0g7QUFsVzBCLENBQS9CO0FBcVdBLENBQUMsQ0FBQyxRQUFELENBQUQsQ0FBWSxLQUFaLENBQWtCLFlBQU07QUFDcEIsRUFBQSxzQkFBc0IsQ0FBQyxVQUF2QjtBQUNILENBRkQiLCJmaWxlIjoibW9kdWxlLXBocmFzZS1zdHVkaW8tc291bmRmaWxlcy5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qIGdsb2JhbCAkLCBnbG9iYWxUcmFuc2xhdGUsIFNvdW5kRmlsZXNBUEksIFVzZXJNZXNzYWdlLCBzbmRQbGF5ZXIgKi9cblxuLyoqXG4gKiBQaHJhc2UgU3R1ZGlvIGludGVncmF0aW9uIGZvciB0aGUgU291bmRGaWxlcyBtb2RpZnkgcGFnZS5cbiAqXG4gKiBUaGUgUEhQIHNpZGUgKFBocmFzZVN0dWRpb0NvbmY6Om9uVm9sdEJsb2NrQ29tcGlsZSkgcmVuZGVycyBvdXIgcGFydGlhbFxuICogaW5zaWRlIGNvcmUncyBgaG9va1ZvbHRCbG9jaygnRmllbGRzJylgLCB3aGljaCBsYW5kcyBhdCB0aGUgYm90dG9tIG9mXG4gKiB0aGUgZm9ybS4gV2UgbW92ZSB0aGUgcmVuZGVyZWQgc2VnbWVudCB1bmRlciB0aGUgdXBsb2FkL3JlY29yZCBibG9ja1xuICogYW5kIHdpcmUgaXQgdG8gdGhlIG1vZHVsZSdzIFJFU1QgQVBJIHBsdXMgdGhlIGV4aXN0aW5nIGNvbnZlcnRBdWRpb0ZpbGVcbiAqIHBpcGVsaW5lIHNvIHRoZSBnZW5lcmF0ZWQgV0FWIGJlY29tZXMgdGhlIGZvcm0ncyBzb3VyY2UgZmlsZS5cbiAqL1xuY29uc3QgcGhyYXNlU3R1ZGlvU291bmRGaWxlcyA9IHtcbiAgICBhcGk6IHtcbiAgICAgICAgdm9pY2VzOiAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby92b2ljZXMnLFxuICAgICAgICBwaHJhc2VzOiAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL3BocmFzZXMnLFxuICAgICAgICBwcm9tb3RlOiAoaWQpID0+IGAvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vcGhyYXNlcy8ke2lkfTpwcm9tb3RlVG9UbXBgLFxuICAgIH0sXG5cbiAgICBzdGF0ZToge1xuICAgICAgICB2b2ljZXM6IFtdLFxuICAgICAgICBoaXN0b3J5OiBbXSxcbiAgICAgICAgZGVmYXVsdFZvaWNlOiAnJyxcbiAgICAgICAgZGVmYXVsdFNhbXBsZVJhdGU6ICduYXRpdmUnLFxuICAgIH0sXG5cbiAgICBpbml0aWFsaXplKCkge1xuICAgICAgICBjb25zdCAkc2VnbWVudCA9ICQoJyNwaHJhc2Utc3R1ZGlvLXNmLXNlZ21lbnQnKTtcbiAgICAgICAgaWYgKCRzZWdtZW50Lmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTU9IIG11c2ljIGZpbGVzIGRvbid0IGZpdCB0aGUgVFRTIHVzZSBjYXNlIOKAlCBoaWRlIGVudGlyZWx5LlxuICAgICAgICBpZiAocGhyYXNlU3R1ZGlvU291bmRGaWxlcy5nZXRDYXRlZ29yeSgpID09PSAnbW9oJykge1xuICAgICAgICAgICAgJHNlZ21lbnQucmVtb3ZlKCk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBNb3ZlIHRoZSBzZWdtZW50IHVuZGVyIHRoZSB1cGxvYWQvcmVjb3JkIGJsb2NrLlxuICAgICAgICBjb25zdCAkZm9ybSA9ICQoJyNzb3VuZC1maWxlLWZvcm0nKTtcbiAgICAgICAgY29uc3QgJHNvdXJjZVNlZ21lbnQgPSAkZm9ybS5jaGlsZHJlbignLnVpLnNlZ21lbnQnKS5maXJzdCgpO1xuICAgICAgICBpZiAoJHNvdXJjZVNlZ21lbnQubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgJHNlZ21lbnQuaW5zZXJ0QWZ0ZXIoJHNvdXJjZVNlZ21lbnQpO1xuICAgICAgICB9XG5cbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tc2Ytc2FtcGxlLXJhdGUnKS5kcm9wZG93bigpO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1zZi10ZXh0Jykub24oJ2lucHV0JywgcGhyYXNlU3R1ZGlvU291bmRGaWxlcy51cGRhdGVDb3VudGVyKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tc2YtZ2VuZXJhdGUnKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9Tb3VuZEZpbGVzLm9uR2VuZXJhdGUpO1xuXG4gICAgICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMubG9hZERlZmF1bHRzQW5kVm9pY2VzKCk7XG4gICAgICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMucmVmcmVzaEhpc3RvcnkoKTtcbiAgICB9LFxuXG4gICAgZ2V0Q2F0ZWdvcnkoKSB7XG4gICAgICAgIGNvbnN0IGlkVmFsdWUgPSAoJCgnI2lkJykudmFsKCkgfHwgJycpLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmIChpZFZhbHVlID09PSAnbW9oJyB8fCBpZFZhbHVlID09PSAnY3VzdG9tJykge1xuICAgICAgICAgICAgcmV0dXJuIGlkVmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZm9ybUNhdGVnb3J5ID0gKCQoJyNjYXRlZ29yeScpLnZhbCgpIHx8ICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICBpZiAoZm9ybUNhdGVnb3J5ID09PSAnbW9oJyB8fCBmb3JtQ2F0ZWdvcnkgPT09ICdjdXN0b20nKSB7XG4gICAgICAgICAgICByZXR1cm4gZm9ybUNhdGVnb3J5O1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0IHVybE1hdGNoID0gd2luZG93LmxvY2F0aW9uLnBhdGhuYW1lLm1hdGNoKC9cXC9zb3VuZC1maWxlc1xcL21vZGlmeVxcLyhbYS16XSspL2kpO1xuICAgICAgICBpZiAodXJsTWF0Y2ggJiYgdXJsTWF0Y2hbMV0pIHtcbiAgICAgICAgICAgIHJldHVybiB1cmxNYXRjaFsxXS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiAnJztcbiAgICB9LFxuXG4gICAgdXBkYXRlQ291bnRlcigpIHtcbiAgICAgICAgY29uc3QgJHRhID0gJCgnI3BocmFzZS1zdHVkaW8tc2YtdGV4dCcpO1xuICAgICAgICBjb25zdCB2YWx1ZSA9ICR0YS52YWwoKSB8fCAnJztcbiAgICAgICAgY29uc3QgbWF4ID0gcGFyc2VJbnQoJHRhLmF0dHIoJ21heGxlbmd0aCcpIHx8ICc4MDAnLCAxMCk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXNmLWNvdW50ZXInKS50ZXh0KGAke3ZhbHVlLmxlbmd0aH0gLyAke21heH1gKTtcbiAgICB9LFxuXG4gICAgbG9hZERlZmF1bHRzQW5kVm9pY2VzKCkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9Tb3VuZEZpbGVzLmFwaS52b2ljZXMsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHZvaWNlcyA9ICgocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSkgfHwgW10pLmZpbHRlcigodikgPT4gdi5pbnN0YWxsZWQpO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5zdGF0ZS52b2ljZXMgPSB2b2ljZXM7XG5cbiAgICAgICAgICAgIGNvbnN0IHN0dWRpb0RlZmF1bHRzID0gd2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzIHx8IHt9O1xuICAgICAgICAgICAgY29uc3QgZmFsbGJhY2tWb2ljZSA9IHZvaWNlcy5sZW5ndGggPiAwID8gdm9pY2VzWzBdLnZvaWNlX2lkIDogJyc7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9Tb3VuZEZpbGVzLnN0YXRlLmRlZmF1bHRWb2ljZSA9XG4gICAgICAgICAgICAgICAgc3R1ZGlvRGVmYXVsdHMudm9pY2UgfHwgZmFsbGJhY2tWb2ljZTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMuc3RhdGUuZGVmYXVsdFNhbXBsZVJhdGUgPVxuICAgICAgICAgICAgICAgIHN0dWRpb0RlZmF1bHRzLnNhbXBsZVJhdGUgfHwgJ25hdGl2ZSc7XG5cbiAgICAgICAgICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMucmVuZGVyVm9pY2VzKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5kaXNhYmxlQmxvY2soXG4gICAgICAgICAgICAgICAgZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VzTGlzdCB8fCAnJ1xuICAgICAgICAgICAgKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlclZvaWNlcygpIHtcbiAgICAgICAgY29uc3QgJHNlbGVjdCA9ICQoJyNwaHJhc2Utc3R1ZGlvLXNmLXZvaWNlJykuZW1wdHkoKTtcbiAgICAgICAgY29uc3Qgdm9pY2VzID0gcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5zdGF0ZS52b2ljZXM7XG5cbiAgICAgICAgaWYgKHZvaWNlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMuZGlzYWJsZUJsb2NrKFxuICAgICAgICAgICAgICAgIGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Tb3VuZEZpbGVzSG9va05vVm9pY2VcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBkZXNpcmVkID0gcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5zdGF0ZS5kZWZhdWx0Vm9pY2U7XG4gICAgICAgIGNvbnN0IHNlbGVjdGVkVm9pY2UgPSB2b2ljZXMuc29tZSgodikgPT4gdi52b2ljZV9pZCA9PT0gZGVzaXJlZClcbiAgICAgICAgICAgID8gZGVzaXJlZFxuICAgICAgICAgICAgOiB2b2ljZXNbMF0udm9pY2VfaWQ7XG5cbiAgICAgICAgdm9pY2VzLmZvckVhY2goKHZvaWNlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBsYWJlbCA9IGAke3ZvaWNlLmxhbmd1YWdlIHx8ICcnfSDigJQgJHt2b2ljZS52b2ljZV9uYW1lIHx8IHZvaWNlLnZvaWNlX2lkfWA7XG4gICAgICAgICAgICBjb25zdCAkb3B0ID0gJCgnPG9wdGlvbj4nKVxuICAgICAgICAgICAgICAgIC52YWwodm9pY2Uudm9pY2VfaWQpXG4gICAgICAgICAgICAgICAgLnRleHQobGFiZWwudHJpbSgpLnJlcGxhY2UoL17igJRcXHMqLywgJycpKTtcbiAgICAgICAgICAgIGlmICh2b2ljZS52b2ljZV9pZCA9PT0gc2VsZWN0ZWRWb2ljZSkge1xuICAgICAgICAgICAgICAgICRvcHQuYXR0cignc2VsZWN0ZWQnLCAnc2VsZWN0ZWQnKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICRzZWxlY3QuYXBwZW5kKCRvcHQpO1xuICAgICAgICB9KTtcbiAgICAgICAgJHNlbGVjdC52YWwoc2VsZWN0ZWRWb2ljZSk7XG5cbiAgICAgICAgLy8gU2VtYW50aWMgc25hcHNob3RzIG9wdGlvbnMgYXQgaW5pdC10aW1lLCBzbyB3ZSBpbml0aWFsaXNlIG9ubHlcbiAgICAgICAgLy8gYWZ0ZXIgdGhlIGxpc3QgaGFzIGJlZW4gcG9wdWxhdGVkLlxuICAgICAgICAkc2VsZWN0LmRyb3Bkb3duKHsgZnVsbFRleHRTZWFyY2g6IHRydWUgfSk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXNmLXNhbXBsZS1yYXRlJylcbiAgICAgICAgICAgIC5kcm9wZG93bignc2V0IHNlbGVjdGVkJywgcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5zdGF0ZS5kZWZhdWx0U2FtcGxlUmF0ZSk7XG4gICAgfSxcblxuICAgIHJlZnJlc2hIaXN0b3J5KCkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9Tb3VuZEZpbGVzLmFwaS5waHJhc2VzLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCByb3dzID0gKHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGEpIHx8IFtdO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5zdGF0ZS5oaXN0b3J5ID0gcm93cztcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMucmVuZGVySGlzdG9yeSgpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcmVuZGVySGlzdG9yeSgpIHtcbiAgICAgICAgY29uc3Qgcm93cyA9IHBocmFzZVN0dWRpb1NvdW5kRmlsZXMuc3RhdGUuaGlzdG9yeTtcbiAgICAgICAgY29uc3QgJGZpZWxkID0gJCgnI3BocmFzZS1zdHVkaW8tc2YtaGlzdG9yeS1maWVsZCcpO1xuICAgICAgICBjb25zdCAkc2VsZWN0ID0gJCgnI3BocmFzZS1zdHVkaW8tc2YtaGlzdG9yeScpO1xuXG4gICAgICAgIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgJGZpZWxkLmhpZGUoKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkZmllbGQuc2hvdygpO1xuXG4gICAgICAgIC8vIFRlYXIgZG93biB0aGUgZHJvcGRvd24gc28gb3B0aW9ucyBjYW4gYmUgcmUtcmVuZGVyZWQgY2xlYW5seS5cbiAgICAgICAgaWYgKCRzZWxlY3QuaGFzQ2xhc3MoJ3VpJykpIHtcbiAgICAgICAgICAgICRzZWxlY3QuZHJvcGRvd24oJ2Rlc3Ryb3knKTtcbiAgICAgICAgfVxuXG4gICAgICAgICRzZWxlY3Qub2ZmKCdjaGFuZ2UucGhyYXNlU3R1ZGlvJykuZW1wdHkoKTtcbiAgICAgICAgJHNlbGVjdC5hcHBlbmQoXG4gICAgICAgICAgICAkKCc8b3B0aW9uPicpLnZhbCgnJykudGV4dChcbiAgICAgICAgICAgICAgICBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fU291bmRGaWxlc0hvb2tIaXN0b3J5UGxhY2Vob2xkZXIgfHwgJydcbiAgICAgICAgICAgIClcbiAgICAgICAgKTtcblxuICAgICAgICByb3dzLmZvckVhY2goKHJvdykgPT4ge1xuICAgICAgICAgICAgY29uc3QgY3JlYXRlZCA9IHBocmFzZVN0dWRpb1NvdW5kRmlsZXMuZm9ybWF0VGltZXN0YW1wKHJvdy5jcmVhdGVkX2F0KTtcbiAgICAgICAgICAgIGNvbnN0IHRleHQgPSAocm93LnRleHQgfHwgJycpLnJlcGxhY2UoL1xccysvZywgJyAnKS50cmltKCk7XG4gICAgICAgICAgICBjb25zdCBzbmlwcGV0ID0gdGV4dC5sZW5ndGggPiA2MCA/IGAke3RleHQuc2xpY2UoMCwgNjApfeKApmAgOiB0ZXh0O1xuICAgICAgICAgICAgY29uc3QgbGFiZWwgPSBgJHtjcmVhdGVkfSDCtyAke3Jvdy52b2ljZV9pZCB8fCAnJ30gwrcgJHtzbmlwcGV0fWA7XG4gICAgICAgICAgICAkKCc8b3B0aW9uPicpLnZhbChTdHJpbmcocm93LmlkKSkudGV4dChsYWJlbCkuYXBwZW5kVG8oJHNlbGVjdCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgICRzZWxlY3QuZHJvcGRvd24oeyBmdWxsVGV4dFNlYXJjaDogdHJ1ZSB9KTtcbiAgICAgICAgJHNlbGVjdC5vbignY2hhbmdlLnBocmFzZVN0dWRpbycsIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMub25IaXN0b3J5UGljayk7XG4gICAgfSxcblxuICAgIGZvcm1hdFRpbWVzdGFtcCh1bml4KSB7XG4gICAgICAgIGNvbnN0IHRzID0gcGFyc2VJbnQodW5peCwgMTApO1xuICAgICAgICBpZiAoIXRzIHx8IE51bWJlci5pc05hTih0cykpIHtcbiAgICAgICAgICAgIHJldHVybiAnJztcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBkID0gbmV3IERhdGUodHMgKiAxMDAwKTtcbiAgICAgICAgY29uc3QgcGFkID0gKG4pID0+IChuIDwgMTAgPyBgMCR7bn1gIDogYCR7bn1gKTtcbiAgICAgICAgcmV0dXJuIGAke2QuZ2V0RnVsbFllYXIoKX0tJHtwYWQoZC5nZXRNb250aCgpICsgMSl9LSR7cGFkKGQuZ2V0RGF0ZSgpKX0gYFxuICAgICAgICAgICAgKyBgJHtwYWQoZC5nZXRIb3VycygpKX06JHtwYWQoZC5nZXRNaW51dGVzKCkpfWA7XG4gICAgfSxcblxuICAgIG9uSGlzdG9yeVBpY2soKSB7XG4gICAgICAgIGNvbnN0IHBocmFzZUlkID0gcGFyc2VJbnQoJCgnI3BocmFzZS1zdHVkaW8tc2YtaGlzdG9yeScpLnZhbCgpIHx8ICcwJywgMTApO1xuICAgICAgICBpZiAoIXBocmFzZUlkKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3Qgcm93ID0gcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5zdGF0ZS5oaXN0b3J5LmZpbmQoXG4gICAgICAgICAgICAocikgPT4gcGFyc2VJbnQoci5pZCwgMTApID09PSBwaHJhc2VJZFxuICAgICAgICApO1xuICAgICAgICBpZiAocm93KSB7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1zZi10ZXh0JykudmFsKHJvdy50ZXh0IHx8ICcnKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMudXBkYXRlQ291bnRlcigpO1xuICAgICAgICAgICAgaWYgKHJvdy52b2ljZV9pZCkge1xuICAgICAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXNmLXZvaWNlJykuZHJvcGRvd24oJ3NldCBzZWxlY3RlZCcsIHJvdy52b2ljZV9pZCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzdWdnZXN0ZWROYW1lID0gKCQoJyNuYW1lJykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgY29uc3QgJGJ0biA9ICQoJyNwaHJhc2Utc3R1ZGlvLXNmLWdlbmVyYXRlJykuYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgY29uc3QgJGZvcm0gPSAkKCcjc291bmQtZmlsZS1mb3JtJykuYWRkQ2xhc3MoJ2xvYWRpbmcnKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tc2Ytc3RhdHVzJykudGV4dCgnJyk7XG5cbiAgICAgICAgcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5wcm9tb3RlQW5kQ29udmVydChwaHJhc2VJZCwgc3VnZ2VzdGVkTmFtZSwgJGJ0biwgJGZvcm0pO1xuICAgIH0sXG5cbiAgICBkaXNhYmxlQmxvY2sobWVzc2FnZSkge1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1zZi10ZXh0JykucHJvcCgnZGlzYWJsZWQnLCB0cnVlKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tc2YtZ2VuZXJhdGUnKS5hZGRDbGFzcygnZGlzYWJsZWQnKTtcbiAgICAgICAgaWYgKG1lc3NhZ2UpIHtcbiAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXNmLXN0YXR1cycpLnRleHQobWVzc2FnZSk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgb25HZW5lcmF0ZSgpIHtcbiAgICAgICAgY29uc3QgdGV4dCA9ICgkKCcjcGhyYXNlLXN0dWRpby1zZi10ZXh0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgY29uc3Qgdm9pY2VJZCA9ICQoJyNwaHJhc2Utc3R1ZGlvLXNmLXZvaWNlJykudmFsKCkgfHwgJyc7XG4gICAgICAgIGNvbnN0IHNhbXBsZVJhdGUgPSAkKCcjcGhyYXNlLXN0dWRpby1zZi1zYW1wbGUtcmF0ZScpLnZhbCgpIHx8ICduYXRpdmUnO1xuICAgICAgICBpZiAoIXRleHQgfHwgIXZvaWNlSWQpIHtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhcbiAgICAgICAgICAgICAgICBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVmFsaWRhdGlvbk1pc3NpbmdcbiAgICAgICAgICAgICk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBzdWdnZXN0ZWROYW1lID0gKCQoJyNuYW1lJykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgY29uc3QgJGJ0biA9ICQoJyNwaHJhc2Utc3R1ZGlvLXNmLWdlbmVyYXRlJykuYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgY29uc3QgJGZvcm0gPSAkKCcjc291bmQtZmlsZS1mb3JtJykuYWRkQ2xhc3MoJ2xvYWRpbmcnKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tc2Ytc3RhdHVzJykudGV4dCgnJyk7XG5cbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5hcGkucGhyYXNlcyxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoeyB0ZXh0LCB2b2ljZV9pZDogdm9pY2VJZCwgc2FtcGxlX3JhdGU6IHNhbXBsZVJhdGUgfSksXG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSByZXNwb25zZSAmJiByZXNwb25zZS5kYXRhO1xuICAgICAgICAgICAgaWYgKCFkYXRhIHx8ICFkYXRhLnBocmFzZV9pZCkge1xuICAgICAgICAgICAgICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMucmVsZWFzZUxvYWRpbmcoJGJ0biwgJGZvcm0pO1xuICAgICAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhcbiAgICAgICAgICAgICAgICAgICAgKHJlc3BvbnNlICYmIHJlc3BvbnNlLm1lc3NhZ2VzKVxuICAgICAgICAgICAgICAgICAgICAgICAgfHwgZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yR2VuZXJhdGVcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMucHJvbW90ZUFuZENvbnZlcnQoXG4gICAgICAgICAgICAgICAgZGF0YS5waHJhc2VfaWQsIHN1Z2dlc3RlZE5hbWUsICRidG4sICRmb3JtXG4gICAgICAgICAgICApO1xuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMucmVsZWFzZUxvYWRpbmcoJGJ0biwgJGZvcm0pO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKFxuICAgICAgICAgICAgICAgIGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckdlbmVyYXRlXG4gICAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcHJvbW90ZUFuZENvbnZlcnQocGhyYXNlSWQsIHN1Z2dlc3RlZE5hbWUsICRidG4sICRmb3JtKSB7XG4gICAgICAgIGNvbnN0IGNhdGVnb3J5ID0gJGZvcm0uZm9ybSgnZ2V0IHZhbHVlJywgJ2NhdGVnb3J5JylcbiAgICAgICAgICAgIHx8ICQoJyNjYXRlZ29yeScpLnZhbCgpXG4gICAgICAgICAgICB8fCAnY3VzdG9tJztcblxuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9Tb3VuZEZpbGVzLmFwaS5wcm9tb3RlKHBocmFzZUlkKSxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoeyBuYW1lOiBzdWdnZXN0ZWROYW1lLCBjYXRlZ29yeSB9KSxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgLy8gUHJvbW90ZSBkb2VzIHN0YWdpbmcgKyBoaWdoLXF1YWxpdHkgY29udmVyc2lvbiBpbiBvbmUgc2hvdCxcbiAgICAgICAgICAgIC8vIHNvIHdlIHNraXAgU291bmRGaWxlc0FQSS5jb252ZXJ0QXVkaW9GaWxlIChpdCB3b3VsZCByZS1lbmNvZGVcbiAgICAgICAgICAgIC8vIGF0IDgga0h6IC8gMTYga2JpdCBNUDMgYW5kIHJ1aW4gdGhlIGNsZWFuIFBpcGVyIG91dHB1dCkuXG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9Tb3VuZEZpbGVzLm9uQ29udmVydGVkKHJlc3BvbnNlLCAkYnRuLCAkZm9ybSk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5yZWxlYXNlTG9hZGluZygkYnRuLCAkZm9ybSk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoXG4gICAgICAgICAgICAgICAgZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yR2VuZXJhdGVcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBvbkNvbnZlcnRlZChyZXNwb25zZSwgJGJ0biwgJGZvcm0pIHtcbiAgICAgICAgcGhyYXNlU3R1ZGlvU291bmRGaWxlcy5yZWxlYXNlTG9hZGluZygkYnRuLCAkZm9ybSk7XG5cbiAgICAgICAgY29uc3QgcHJvbW90ZWQgPSByZXNwb25zZSAmJiByZXNwb25zZS5kYXRhO1xuICAgICAgICBpZiAoIXByb21vdGVkIHx8ICFwcm9tb3RlZC5wYXRoKSB7XG4gICAgICAgICAgICBjb25zdCBlcnJvck1zZyA9IChyZXNwb25zZSAmJiByZXNwb25zZS5tZXNzYWdlcyAmJiByZXNwb25zZS5tZXNzYWdlcy5lcnJvcilcbiAgICAgICAgICAgICAgICA/IFtdLmNvbmNhdChyZXNwb25zZS5tZXNzYWdlcy5lcnJvcikuam9pbignPGJyPicpXG4gICAgICAgICAgICAgICAgOiBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JHZW5lcmF0ZTtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhlcnJvck1zZyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICBjb25zdCBmaWxlbmFtZSA9IHByb21vdGVkLnBhdGg7XG5cbiAgICAgICAgaWYgKCEoJCgnI25hbWUnKS52YWwoKSB8fCAnJykudHJpbSgpICYmIHByb21vdGVkLmJhc2VuYW1lKSB7XG4gICAgICAgICAgICAkKCcjbmFtZScpLnZhbChwcm9tb3RlZC5iYXNlbmFtZSkudHJpZ2dlcignY2hhbmdlJyk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBQdXNoIHRoZSBwcmV2aW91cyBwYXRoIGludG8gY29yZSdzIHRyYXNoQmluIChtaXJyb3JzXG4gICAgICAgIC8vIHNvdW5kRmlsZU1vZGlmeVJlc3QuY2JBZnRlckNvbnZlcnRGaWxlKSBzbyB0aGUgb2xkIGNvbnZlcnRlZFxuICAgICAgICAvLyBhcnRpZmFjdCBnZXRzIHVubGlua2VkIHdoZW4gdGhlIGZvcm0gaXMgc2F2ZWQuIFNraXAgdGhlIHZlcnlcbiAgICAgICAgLy8gZmlyc3QgcHJvbW90ZSBvbiBhIG5ldyByZWNvcmQgKG5vIHByaW9yIHBhdGgpIGFuZCBhdm9pZCBwdXNoaW5nXG4gICAgICAgIC8vIHRoZSBzYW1lIHBhdGggdHdpY2UuXG4gICAgICAgIGNvbnN0IHByZXZpb3VzUGF0aCA9ICRmb3JtLmZvcm0oJ2dldCB2YWx1ZScsICdwYXRoJykgfHwgJyc7XG4gICAgICAgIGlmIChwcmV2aW91c1BhdGhcbiAgICAgICAgICAgICYmIHByZXZpb3VzUGF0aCAhPT0gZmlsZW5hbWVcbiAgICAgICAgICAgICYmIHR5cGVvZiB3aW5kb3cuc291bmRGaWxlTW9kaWZ5UmVzdCAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgICAgICYmIEFycmF5LmlzQXJyYXkod2luZG93LnNvdW5kRmlsZU1vZGlmeVJlc3QudHJhc2hCaW4pXG4gICAgICAgICAgICAmJiB3aW5kb3cuc291bmRGaWxlTW9kaWZ5UmVzdC50cmFzaEJpbi5pbmRleE9mKHByZXZpb3VzUGF0aCkgPT09IC0xKSB7XG4gICAgICAgICAgICB3aW5kb3cuc291bmRGaWxlTW9kaWZ5UmVzdC50cmFzaEJpbi5wdXNoKHByZXZpb3VzUGF0aCk7XG4gICAgICAgIH1cblxuICAgICAgICAkZm9ybS5mb3JtKCdzZXQgdmFsdWUnLCAncGF0aCcsIGZpbGVuYW1lKTtcbiAgICAgICAgJCgnI25hbWUnKS50cmlnZ2VyKCdjaGFuZ2UnKTtcblxuICAgICAgICAvLyBSZXNldCB0aGUgcGxheWVyIGFuZCBzdGFydCBwbGF5aW5nIHRoZSBmcmVzaGx5IGNvbnZlcnRlZCBmaWxlLlxuICAgICAgICAvL1xuICAgICAgICAvLyBUaGUgY29yZSBNb2RpZnlTb3VuZFBsYXllciBjYWNoZXMgdGhlIHByZXZpb3VzIHRha2UgaW5cbiAgICAgICAgLy8gYGh0bWw1QXVkaW8uc3JjYCAoYSBibG9iIFVSTCkuIEl0cyBgcGxheSgpYCBzaG9ydC1jaXJjdWl0cyB3aGVuIGl0XG4gICAgICAgIC8vIHNlZXMgYSBjYWNoZWQgYmxvYiBhbmQgcmVwbGF5cyB0aGUgcHJldmlvdXMgZ2VuZXJhdGlvbi4gV2UgYnlwYXNzXG4gICAgICAgIC8vIHRoYXQgcGF0aCBieSBjbGVhcmluZyB0aGUgY2FjaGVkIGJsb2IsIHVwZGF0aW5nIHRoZSBzb3VyY2UgZm9yIHRoZVxuICAgICAgICAvLyBzZWdtZW50IGNocm9tZSwgYW5kIHRoZW4gY2FsbGluZyBgbG9hZEF1dGhlbnRpY2F0ZWRTb3VyY2UoKWBcbiAgICAgICAgLy8gZGlyZWN0bHkgc28gYSBicmFuZC1uZXcgYmxvYiBpcyBmZXRjaGVkICsgYXV0by1wbGF5ZWQgZWFjaCB0aW1lLlxuICAgICAgICBpZiAodHlwZW9mIHNuZFBsYXllciAhPT0gJ3VuZGVmaW5lZCcgJiYgc25kUGxheWVyICYmIHNuZFBsYXllci5odG1sNUF1ZGlvKSB7XG4gICAgICAgICAgICBjb25zdCBuZXdVcmwgPSBgL3BieGNvcmUvYXBpL3YzL3NvdW5kLWZpbGVzOnBsYXliYWNrP3ZpZXc9JHtmaWxlbmFtZX1gO1xuICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBzbmRQbGF5ZXIuaHRtbDVBdWRpby5wYXVzZSgpO1xuICAgICAgICAgICAgICAgIGlmIChzbmRQbGF5ZXIuaHRtbDVBdWRpby5zcmNcbiAgICAgICAgICAgICAgICAgICAgJiYgc25kUGxheWVyLmh0bWw1QXVkaW8uc3JjLnN0YXJ0c1dpdGgoJ2Jsb2I6JykpIHtcbiAgICAgICAgICAgICAgICAgICAgVVJMLnJldm9rZU9iamVjdFVSTChzbmRQbGF5ZXIuaHRtbDVBdWRpby5zcmMpO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBzbmRQbGF5ZXIuaHRtbDVBdWRpby5yZW1vdmVBdHRyaWJ1dGUoJ3NyYycpO1xuICAgICAgICAgICAgICAgIHNuZFBsYXllci5odG1sNUF1ZGlvLmxvYWQoKTtcbiAgICAgICAgICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgICAgICAgICAgICAvLyBCZXN0LWVmZm9ydCByZXNldCDigJQgZmFpbHVyZXMgYXJlIG5vbi1mYXRhbC5cbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0eXBlb2Ygc25kUGxheWVyLlVwZGF0ZVNvdXJjZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIHNuZFBsYXllci5VcGRhdGVTb3VyY2UobmV3VXJsKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh0eXBlb2Ygc25kUGxheWVyLmxvYWRBdXRoZW50aWNhdGVkU291cmNlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgICAgc25kUGxheWVyLmxvYWRBdXRoZW50aWNhdGVkU291cmNlKG5ld1VybCk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHR5cGVvZiBzbmRQbGF5ZXIucGxheSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIHNuZFBsYXllci5wbGF5KCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBSZWZyZXNoIGhpc3Rvcnkgc28gdGhlIGZyZXNobHkgZ2VuZXJhdGVkIHBocmFzZSBzaG93cyB1cCBpbiB0aGVcbiAgICAgICAgLy8gZHJvcGRvd24gaW1tZWRpYXRlbHkgYW5kIHN0YXlzIGluIHN5bmMgYWZ0ZXIgcmVwZWF0IGdlbmVyYXRpb25zLlxuICAgICAgICBwaHJhc2VTdHVkaW9Tb3VuZEZpbGVzLnJlZnJlc2hIaXN0b3J5KCk7XG4gICAgfSxcblxuICAgIHJlbGVhc2VMb2FkaW5nKCRidG4sICRmb3JtKSB7XG4gICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJGZvcm0ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcnKTtcbiAgICB9LFxufTtcblxuJChkb2N1bWVudCkucmVhZHkoKCkgPT4ge1xuICAgIHBocmFzZVN0dWRpb1NvdW5kRmlsZXMuaW5pdGlhbGl6ZSgpO1xufSk7XG4iXX0=