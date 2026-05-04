"use strict";

/* global $, globalRootUrl, globalTranslate, PbxApi, UserMessage, IndexSoundPlayer, TokenManager, SemanticLocalization */

/**
 * Studio page controller for ModulePhraseStudio.
 *
 * The page has four tabs (studio / voices / engine / history). All data flows
 * through the module's REST v3 endpoints under /pbxcore/api/v3/module-phrase-studio.
 * We rely on PbxApi.callJsonRest helper, which already handles auth headers.
 */
var phraseStudioIndex = {
  api: {
    engine: '/pbxcore/api/v3/module-phrase-studio/engine',
    engineInstall: '/pbxcore/api/v3/module-phrase-studio/engine:install',
    voices: '/pbxcore/api/v3/module-phrase-studio/voices',
    voiceInstall: '/pbxcore/api/v3/module-phrase-studio/voices:install',
    phrases: '/pbxcore/api/v3/module-phrase-studio/phrases',
    saveDefaults: globalRootUrl + 'module-phrase-studio/module-phrase-studio/save'
  },
  state: {
    engine: null,
    voices: [],
    soundPlayers: {},
    historyDataTable: null
  },
  initialize: function initialize() {
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
  applyDefaults: function applyDefaults() {
    var d = window.phraseStudioDefaults || {};

    if (d.sampleRate) {
      $('#phrase-studio-sample-rate').dropdown('set selected', d.sampleRate);
    }
  },
  updateCounter: function updateCounter() {
    var value = $('#phrase-studio-text').val() || '';
    var max = parseInt($('#phrase-studio-text').attr('maxlength') || '800', 10);
    $('#phrase-studio-text-counter').text("".concat(value.length, " / ").concat(max));
  },
  refreshEngine: function refreshEngine() {
    $.ajax({
      url: phraseStudioIndex.api.engine,
      method: 'GET',
      dataType: 'json'
    }).done(function (response) {
      phraseStudioIndex.state.engine = response && response.data || null;
      phraseStudioIndex.renderEngine();
    }).fail(function () {
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorEngineStatus);
    });
  },
  renderEngine: function renderEngine() {
    var $box = $('#phrase-studio-engine-status').empty();
    var data = phraseStudioIndex.state.engine || {};

    if (data.installed) {
      $box.append($('<div>').addClass('ui positive message').append($('<div>').addClass('header').text(globalTranslate.module_phrase_studio_EngineInstalled)).append($('<p>').text("".concat(globalTranslate.module_phrase_studio_EngineVersion, ": ").concat(data.version || '—'))).append($('<button>').addClass('ui small red basic button').text(globalTranslate.module_phrase_studio_EngineUninstall).on('click', phraseStudioIndex.onEngineUninstall)));
    } else {
      $box.append($('<div>').addClass('ui warning message').append($('<div>').addClass('header').text(globalTranslate.module_phrase_studio_EngineNotInstalled)).append($('<p>').text(globalTranslate.module_phrase_studio_EngineInstallHint)).append($('<button>').addClass('ui primary button').text(globalTranslate.module_phrase_studio_EngineInstall).on('click', phraseStudioIndex.onEngineInstall)));
    }
  },
  onEngineInstall: function onEngineInstall() {
    var $btn = $(this);
    $btn.addClass('loading disabled');
    $.ajax({
      url: phraseStudioIndex.api.engineInstall,
      method: 'POST',
      dataType: 'json'
    }).done(function (response) {
      $btn.removeClass('loading disabled');
      phraseStudioIndex.refreshEngine();

      if (response && response.result === false) {
        UserMessage.showMultiString(response.messages);
      }
    }).fail(function () {
      $btn.removeClass('loading disabled');
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorEngineInstall);
    });
  },
  onEngineUninstall: function onEngineUninstall() {
    var $btn = $(this);
    $btn.addClass('loading disabled');
    $.ajax({
      url: phraseStudioIndex.api.engine,
      method: 'DELETE',
      dataType: 'json'
    }).done(function () {
      $btn.removeClass('loading disabled');
      phraseStudioIndex.refreshEngine();
    }).fail(function () {
      $btn.removeClass('loading disabled');
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorEngineUninstall);
    });
  },
  refreshVoices: function refreshVoices() {
    $.ajax({
      url: phraseStudioIndex.api.voices,
      method: 'GET',
      dataType: 'json'
    }).done(function (response) {
      phraseStudioIndex.state.voices = response && response.data || [];
      phraseStudioIndex.renderVoicesTable();
      phraseStudioIndex.renderVoicePicker();
    }).fail(function () {
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorVoicesList);
    });
  },
  renderVoicesTable: function renderVoicesTable() {
    var $tbody = $('#phrase-studio-voices-table tbody').empty();
    phraseStudioIndex.state.voices.forEach(function (voice) {
      var $row = $('<tr>');
      $row.append($('<td>').text("".concat(voice.language_label, " (").concat(voice.language, ")")));
      $row.append($('<td>').text(voice.voice_name));
      $row.append($('<td>').text(voice.quality));
      $row.append($('<td>').text("".concat(voice.sample_rate, " Hz")));
      $row.append($('<td>').html(voice.installed ? "<span class=\"ui green label\">".concat(globalTranslate.module_phrase_studio_VoiceInstalled, "</span>") : "<span class=\"ui label\">".concat(globalTranslate.module_phrase_studio_VoiceNotInstalled, "</span>")));
      var $actions = $('<td>').addClass('right aligned');

      if (voice.installed) {
        $actions.append($('<button>').addClass('ui small basic red icon button').attr('data-voice', voice.voice_id).attr('title', globalTranslate.module_phrase_studio_VoiceDelete).append('<i class="trash icon"></i>').on('click', phraseStudioIndex.onVoiceUninstall));
      } else {
        $actions.append($('<button>').addClass('ui small primary icon button').attr('data-voice', voice.voice_id).attr('title', globalTranslate.module_phrase_studio_VoiceInstall).append('<i class="download icon"></i>').on('click', phraseStudioIndex.onVoiceInstall));
      }

      $row.append($actions);
      $tbody.append($row);
    });
  },
  renderVoicePicker: function renderVoicePicker() {
    var $select = $('#phrase-studio-voice');
    var previous = $select.val();
    var fallback = (window.phraseStudioDefaults || {}).voice || '';
    $select.empty();
    var installed = phraseStudioIndex.state.voices.filter(function (v) {
      return v.installed;
    });

    if (installed.length === 0) {
      $select.append($('<option>').val('').text(globalTranslate.module_phrase_studio_PickerEmpty));
    } else {
      installed.forEach(function (voice) {
        $select.append($('<option>').val(voice.voice_id).text("".concat(voice.language_label, " \u2014 ").concat(voice.voice_name, " (").concat(voice.quality, ")")));
      });
    }

    $select.dropdown({
      fullTextSearch: true
    });
    var want = previous || fallback;

    if (want) {
      $select.dropdown('set selected', want);
    }
  },
  onVoiceInstall: function onVoiceInstall() {
    var $btn = $(this);
    var voiceId = $btn.data('voice');
    $btn.addClass('loading disabled');
    $.ajax({
      url: phraseStudioIndex.api.voiceInstall,
      method: 'POST',
      data: JSON.stringify({
        voice_id: voiceId
      }),
      contentType: 'application/json',
      dataType: 'json'
    }).done(function () {
      phraseStudioIndex.refreshVoices();
    }).fail(function () {
      $btn.removeClass('loading disabled');
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorVoiceInstall);
    });
  },
  onVoiceUninstall: function onVoiceUninstall() {
    var $btn = $(this);
    var voiceId = $btn.data('voice');
    $btn.addClass('loading disabled');
    $.ajax({
      url: "".concat(phraseStudioIndex.api.voices, "/").concat(encodeURIComponent(voiceId)),
      method: 'DELETE',
      dataType: 'json'
    }).done(function () {
      phraseStudioIndex.refreshVoices();
    }).fail(function () {
      $btn.removeClass('loading disabled');
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorVoiceUninstall);
    });
  },
  onGenerate: function onGenerate() {
    var text = ($('#phrase-studio-text').val() || '').trim();
    var voiceId = $('#phrase-studio-voice').val() || '';
    var sampleRate = $('#phrase-studio-sample-rate').val() || 'native';

    if (!text || !voiceId) {
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ValidationMissing);
      return;
    }

    var $btn = $('#phrase-studio-generate-button').addClass('loading disabled');
    $.ajax({
      url: phraseStudioIndex.api.phrases,
      method: 'POST',
      data: JSON.stringify({
        text: text,
        voice_id: voiceId,
        sample_rate: sampleRate
      }),
      contentType: 'application/json',
      dataType: 'json'
    }).done(function (response) {
      $btn.removeClass('loading disabled');
      var data = response && response.data;

      if (!data || !data.phrase_id) {
        UserMessage.showMultiString(response && response.messages ? response.messages : globalTranslate.module_phrase_studio_ErrorGenerate);
        return;
      }

      if ($('#phrase-studio-remember').is(':checked')) {
        phraseStudioIndex.persistDefaults(voiceId, sampleRate);
      } // Switch to History tab — the new row carries the standard
      // SoundFiles-style player so the user can listen and download
      // there. Avoids duplicating the player UI on the Studio tab.


      phraseStudioIndex.refreshHistory(function () {
        $('#phrase-studio-tab-menu .item[data-tab=history]').tab('change tab', 'history');
      });
    }).fail(function () {
      $btn.removeClass('loading disabled');
      UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorGenerate);
    });
  },
  persistDefaults: function persistDefaults(voiceId, sampleRate) {
    $.ajax({
      url: phraseStudioIndex.api.saveDefaults,
      method: 'POST',
      data: {
        default_voice: voiceId,
        default_sample_rate: sampleRate
      }
    }).done(function () {
      window.phraseStudioDefaults = {
        voice: voiceId,
        sampleRate: sampleRate
      };
    });
  },
  refreshHistory: function refreshHistory(callback) {
    $.ajax({
      url: phraseStudioIndex.api.phrases,
      method: 'GET',
      dataType: 'json'
    }).done(function (response) {
      phraseStudioIndex.renderHistory(response && response.data || []);

      if (typeof callback === 'function') {
        callback();
      }
    });
  },
  renderHistory: function renderHistory(rows) {
    // Tear down DataTable + sound players from the previous render.
    if (phraseStudioIndex.state.historyDataTable && $.fn.DataTable.isDataTable('#phrase-studio-history-table')) {
      phraseStudioIndex.state.historyDataTable.destroy();
      phraseStudioIndex.state.historyDataTable = null;
    }

    Object.values(phraseStudioIndex.state.soundPlayers).forEach(function (p) {
      if (p && p.html5Audio) {
        p.html5Audio.pause();
        p.html5Audio.src = '';
      }
    });
    phraseStudioIndex.state.soundPlayers = {};
    var $tbody = $('#phrase-studio-history-table tbody').empty();
    rows.forEach(function (row) {
      $tbody.append(phraseStudioIndex.renderHistoryRow(row));
    });

    if (rows.length === 0) {
      return;
    } // Initialise DataTable + sound players, mirroring SoundFiles index.


    phraseStudioIndex.state.historyDataTable = $('#phrase-studio-history-table').DataTable({
      lengthChange: false,
      paging: true,
      pageLength: 25,
      searching: true,
      info: false,
      ordering: true,
      language: typeof SemanticLocalization !== 'undefined' ? SemanticLocalization.dataTableLocalisation : undefined,
      order: [[0, 'desc']]
    });
    rows.forEach(function (row) {
      phraseStudioIndex.state.soundPlayers[row.id] = new IndexSoundPlayer("phrase-row-".concat(row.id));
    });
    $('#phrase-studio-history-table').on('click', 'button.delete-button', function onDelete(e) {
      e.preventDefault();
      var id = $(this).data('id');
      if (!id) return;
      $.ajax({
        url: "".concat(phraseStudioIndex.api.phrases, "/").concat(id),
        method: 'DELETE',
        dataType: 'json'
      }).done(function () {
        return phraseStudioIndex.refreshHistory();
      }).fail(function () {
        return UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorHistoryDelete);
      });
    });
  },
  renderHistoryRow: function renderHistoryRow(row) {
    var created = row.created_at ? new Date(row.created_at * 1000).toLocaleString() : '—';
    var text = (row.text || '').substring(0, 80);
    var voiceId = row.voice_id || '';
    var playUrl = "".concat(phraseStudioIndex.api.phrases, "/").concat(row.id, ":download");
    var dlUrl = playUrl;
    var filename = "phrase_".concat(row.id, ".wav");
    return "<tr class=\"file-row\" id=\"phrase-row-".concat(row.id, "\" data-value=\"").concat(playUrl, "\">\n            <td>").concat($('<div>').text(created).html(), "</td>\n            <td><i class=\"file audio outline icon\"></i>").concat($('<div>').text(text).html(), "</td>\n            <td>").concat($('<div>').text(voiceId).html(), "</td>\n            <td class=\"six wide cdr-player hide-on-mobile\">\n                <table>\n                    <tr>\n                        <td class=\"one wide\">\n                            <button class=\"ui tiny basic icon button play-button\">\n                                <i class=\"ui icon play\"></i>\n                            </button>\n                            <audio preload=\"none\" id=\"audio-player-phrase-row-").concat(row.id, "\" data-src=\"").concat(playUrl, "\">\n                                <source src=\"\"/>\n                            </audio>\n                        </td>\n                        <td>\n                            <div class=\"ui range cdr-player\"></div>\n                        </td>\n                        <td class=\"one wide\"><span class=\"cdr-duration\"></span></td>\n                        <td class=\"one wide\">\n                            <button class=\"ui tiny basic icon button download-button\" data-value=\"").concat(dlUrl, "?filename=").concat(filename, "\">\n                                <i class=\"ui icon download\"></i>\n                            </button>\n                        </td>\n                    </tr>\n                </table>\n            </td>\n            <td class=\"collapsing\">\n                <div class=\"ui tiny basic icon buttons action-buttons\">\n                    <button class=\"ui button delete-button\" data-id=\"").concat(row.id, "\"\n                            title=\"").concat(globalTranslate.module_phrase_studio_HistoryDelete, "\">\n                        <i class=\"icon trash red\"></i>\n                    </button>\n                </div>\n            </td>\n        </tr>");
  }
};
$(document).ready(function () {
  phraseStudioIndex.initialize();
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNyYy9tb2R1bGUtcGhyYXNlLXN0dWRpby1pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBTSxpQkFBaUIsR0FBRztBQUN0QixFQUFBLEdBQUcsRUFBRTtBQUNELElBQUEsTUFBTSxFQUFTLDZDQURkO0FBRUQsSUFBQSxhQUFhLEVBQUUscURBRmQ7QUFHRCxJQUFBLE1BQU0sRUFBUyw2Q0FIZDtBQUlELElBQUEsWUFBWSxFQUFHLHFEQUpkO0FBS0QsSUFBQSxPQUFPLEVBQVEsOENBTGQ7QUFNRCxJQUFBLFlBQVksRUFBRyxhQUFhLEdBQUc7QUFOOUIsR0FEaUI7QUFVdEIsRUFBQSxLQUFLLEVBQUU7QUFDSCxJQUFBLE1BQU0sRUFBRSxJQURMO0FBRUgsSUFBQSxNQUFNLEVBQUUsRUFGTDtBQUdILElBQUEsWUFBWSxFQUFFLEVBSFg7QUFJSCxJQUFBLGdCQUFnQixFQUFFO0FBSmYsR0FWZTtBQWlCdEIsRUFBQSxVQWpCc0Isd0JBaUJUO0FBQ1QsSUFBQSxDQUFDLENBQUMsK0JBQUQsQ0FBRCxDQUFtQyxHQUFuQztBQUNBLElBQUEsQ0FBQyxDQUFDLGtDQUFELENBQUQsQ0FBc0MsUUFBdEM7QUFDQSxJQUFBLENBQUMsQ0FBQyw0QkFBRCxDQUFELENBQWdDLFFBQWhDO0FBQ0EsSUFBQSxDQUFDLENBQUMscUJBQUQsQ0FBRCxDQUF5QixFQUF6QixDQUE0QixPQUE1QixFQUFxQyxpQkFBaUIsQ0FBQyxhQUF2RDtBQUNBLElBQUEsQ0FBQyxDQUFDLGdDQUFELENBQUQsQ0FBb0MsRUFBcEMsQ0FBdUMsT0FBdkMsRUFBZ0QsaUJBQWlCLENBQUMsVUFBbEU7QUFDQSxJQUFBLENBQUMsQ0FBQyxxQkFBRCxDQUFELENBQXlCLEVBQXpCLENBQTRCLE9BQTVCLEVBQXFDLGlCQUFpQixDQUFDLGFBQXZEO0FBQ0EsSUFBQSxDQUFDLENBQUMscUJBQUQsQ0FBRCxDQUF5QixF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QUMsRUFYNUUsMkJBVzZGLE9BWDdGLCtmQW9CNEYsS0FwQjVGLHVCQW9COEcsUUFwQjlHLDhaQTZCK0QsR0FBRyxDQUFDLEVBN0JuRSxxREE4QjZCLGVBQWUsQ0FBQyxrQ0E5QjdDO0FBb0NIO0FBdllxQixDQUExQjtBQTBZQSxDQUFDLENBQUMsUUFBRCxDQUFELENBQVksS0FBWixDQUFrQixZQUFNO0FBQ3BCLEVBQUEsaUJBQWlCLENBQUMsVUFBbEI7QUFDSCxDQUZEIiwiZmlsZSI6Im1vZHVsZS1waHJhc2Utc3R1ZGlvLWluZGV4LmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyogZ2xvYmFsICQsIGdsb2JhbFJvb3RVcmwsIGdsb2JhbFRyYW5zbGF0ZSwgUGJ4QXBpLCBVc2VyTWVzc2FnZSwgSW5kZXhTb3VuZFBsYXllciwgVG9rZW5NYW5hZ2VyLCBTZW1hbnRpY0xvY2FsaXphdGlvbiAqL1xuXG4vKipcbiAqIFN0dWRpbyBwYWdlIGNvbnRyb2xsZXIgZm9yIE1vZHVsZVBocmFzZVN0dWRpby5cbiAqXG4gKiBUaGUgcGFnZSBoYXMgZm91ciB0YWJzIChzdHVkaW8gLyB2b2ljZXMgLyBlbmdpbmUgLyBoaXN0b3J5KS4gQWxsIGRhdGEgZmxvd3NcbiAqIHRocm91Z2ggdGhlIG1vZHVsZSdzIFJFU1QgdjMgZW5kcG9pbnRzIHVuZGVyIC9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby5cbiAqIFdlIHJlbHkgb24gUGJ4QXBpLmNhbGxKc29uUmVzdCBoZWxwZXIsIHdoaWNoIGFscmVhZHkgaGFuZGxlcyBhdXRoIGhlYWRlcnMuXG4gKi9cbmNvbnN0IHBocmFzZVN0dWRpb0luZGV4ID0ge1xuICAgIGFwaToge1xuICAgICAgICBlbmdpbmU6ICAgICAgICAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL2VuZ2luZScsXG4gICAgICAgIGVuZ2luZUluc3RhbGw6ICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vZW5naW5lOmluc3RhbGwnLFxuICAgICAgICB2b2ljZXM6ICAgICAgICAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL3ZvaWNlcycsXG4gICAgICAgIHZvaWNlSW5zdGFsbDogICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vdm9pY2VzOmluc3RhbGwnLFxuICAgICAgICBwaHJhc2VzOiAgICAgICAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL3BocmFzZXMnLFxuICAgICAgICBzYXZlRGVmYXVsdHM6ICBnbG9iYWxSb290VXJsICsgJ21vZHVsZS1waHJhc2Utc3R1ZGlvL21vZHVsZS1waHJhc2Utc3R1ZGlvL3NhdmUnLFxuICAgIH0sXG5cbiAgICBzdGF0ZToge1xuICAgICAgICBlbmdpbmU6IG51bGwsXG4gICAgICAgIHZvaWNlczogW10sXG4gICAgICAgIHNvdW5kUGxheWVyczoge30sXG4gICAgICAgIGhpc3RvcnlEYXRhVGFibGU6IG51bGwsXG4gICAgfSxcblxuICAgIGluaXRpYWxpemUoKSB7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRhYi1tZW51IC5pdGVtJykudGFiKCk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXJlbWVtYmVyLWNoZWNrYm94JykuY2hlY2tib3goKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tc2FtcGxlLXJhdGUnKS5kcm9wZG93bigpO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0Jykub24oJ2lucHV0JywgcGhyYXNlU3R1ZGlvSW5kZXgudXBkYXRlQ291bnRlcik7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWdlbmVyYXRlLWJ1dHRvbicpLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uR2VuZXJhdGUpO1xuICAgICAgICAkKCdbZGF0YS10YWI9XCJ2b2ljZXNcIl0nKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoVm9pY2VzKTtcbiAgICAgICAgJCgnW2RhdGEtdGFiPVwiZW5naW5lXCJdJykub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEVuZ2luZSk7XG4gICAgICAgICQoJ1tkYXRhLXRhYj1cImhpc3RvcnlcIl0nKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoSGlzdG9yeSk7XG5cbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguYXBwbHlEZWZhdWx0cygpO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKCk7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMoKTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKTtcbiAgICB9LFxuXG4gICAgYXBwbHlEZWZhdWx0cygpIHtcbiAgICAgICAgY29uc3QgZCA9IHdpbmRvdy5waHJhc2VTdHVkaW9EZWZhdWx0cyB8fCB7fTtcbiAgICAgICAgaWYgKGQuc2FtcGxlUmF0ZSkge1xuICAgICAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tc2FtcGxlLXJhdGUnKS5kcm9wZG93bignc2V0IHNlbGVjdGVkJywgZC5zYW1wbGVSYXRlKTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGVDb3VudGVyKCkge1xuICAgICAgICBjb25zdCB2YWx1ZSA9ICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS52YWwoKSB8fCAnJztcbiAgICAgICAgY29uc3QgbWF4ICAgPSBwYXJzZUludCgkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykuYXR0cignbWF4bGVuZ3RoJykgfHwgJzgwMCcsIDEwKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tdGV4dC1jb3VudGVyJykudGV4dChgJHt2YWx1ZS5sZW5ndGh9IC8gJHttYXh9YCk7XG4gICAgfSxcblxuICAgIHJlZnJlc2hFbmdpbmUoKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5lbmdpbmUsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmVuZ2luZSA9IChyZXNwb25zZSAmJiByZXNwb25zZS5kYXRhKSB8fCBudWxsO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVyRW5naW5lKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckVuZ2luZVN0YXR1cyk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZW5kZXJFbmdpbmUoKSB7XG4gICAgICAgIGNvbnN0ICRib3ggPSAkKCcjcGhyYXNlLXN0dWRpby1lbmdpbmUtc3RhdHVzJykuZW1wdHkoKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmVuZ2luZSB8fCB7fTtcbiAgICAgICAgaWYgKGRhdGEuaW5zdGFsbGVkKSB7XG4gICAgICAgICAgICAkYm94LmFwcGVuZChcbiAgICAgICAgICAgICAgICAkKCc8ZGl2PicpLmFkZENsYXNzKCd1aSBwb3NpdGl2ZSBtZXNzYWdlJylcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgkKCc8ZGl2PicpLmFkZENsYXNzKCdoZWFkZXInKS50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVJbnN0YWxsZWQpKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCQoJzxwPicpLnRleHQoYCR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZVZlcnNpb259OiAke2RhdGEudmVyc2lvbiB8fCAn4oCUJ31gKSlcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgICAgICQoJzxidXR0b24+JylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuYWRkQ2xhc3MoJ3VpIHNtYWxsIHJlZCBiYXNpYyBidXR0b24nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVVbmluc3RhbGwpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uRW5naW5lVW5pbnN0YWxsKVxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJGJveC5hcHBlbmQoXG4gICAgICAgICAgICAgICAgJCgnPGRpdj4nKS5hZGRDbGFzcygndWkgd2FybmluZyBtZXNzYWdlJylcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgkKCc8ZGl2PicpLmFkZENsYXNzKCdoZWFkZXInKS50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVOb3RJbnN0YWxsZWQpKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCQoJzxwPicpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZUluc3RhbGxIaW50KSlcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgICAgICQoJzxidXR0b24+JylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuYWRkQ2xhc3MoJ3VpIHByaW1hcnkgYnV0dG9uJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lSW5zdGFsbClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25FbmdpbmVJbnN0YWxsKVxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIG9uRW5naW5lSW5zdGFsbCgpIHtcbiAgICAgICAgY29uc3QgJGJ0biA9ICQodGhpcyk7XG4gICAgICAgICRidG4uYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLmVuZ2luZUluc3RhbGwsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKCk7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhyZXNwb25zZS5tZXNzYWdlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckVuZ2luZUluc3RhbGwpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgb25FbmdpbmVVbmluc3RhbGwoKSB7XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKHRoaXMpO1xuICAgICAgICAkYnRuLmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5lbmdpbmUsXG4gICAgICAgICAgICBtZXRob2Q6ICdERUxFVEUnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckVuZ2luZVVuaW5zdGFsbCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZWZyZXNoVm9pY2VzKCkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VzLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS52b2ljZXMgPSAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSkgfHwgW107XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJWb2ljZXNUYWJsZSgpO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVyVm9pY2VQaWNrZXIoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VzTGlzdCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZW5kZXJWb2ljZXNUYWJsZSgpIHtcbiAgICAgICAgY29uc3QgJHRib2R5ID0gJCgnI3BocmFzZS1zdHVkaW8tdm9pY2VzLXRhYmxlIHRib2R5JykuZW1wdHkoKTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzLmZvckVhY2goKHZvaWNlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCAkcm93ID0gJCgnPHRyPicpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQoYCR7dm9pY2UubGFuZ3VhZ2VfbGFiZWx9ICgke3ZvaWNlLmxhbmd1YWdlfSlgKSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykudGV4dCh2b2ljZS52b2ljZV9uYW1lKSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykudGV4dCh2b2ljZS5xdWFsaXR5KSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykudGV4dChgJHt2b2ljZS5zYW1wbGVfcmF0ZX0gSHpgKSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykuaHRtbCh2b2ljZS5pbnN0YWxsZWRcbiAgICAgICAgICAgICAgICA/IGA8c3BhbiBjbGFzcz1cInVpIGdyZWVuIGxhYmVsXCI+JHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VJbnN0YWxsZWR9PC9zcGFuPmBcbiAgICAgICAgICAgICAgICA6IGA8c3BhbiBjbGFzcz1cInVpIGxhYmVsXCI+JHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VOb3RJbnN0YWxsZWR9PC9zcGFuPmApKTtcbiAgICAgICAgICAgIGNvbnN0ICRhY3Rpb25zID0gJCgnPHRkPicpLmFkZENsYXNzKCdyaWdodCBhbGlnbmVkJyk7XG4gICAgICAgICAgICBpZiAodm9pY2UuaW5zdGFsbGVkKSB7XG4gICAgICAgICAgICAgICAgJGFjdGlvbnMuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpLmFkZENsYXNzKCd1aSBzbWFsbCBiYXNpYyByZWQgaWNvbiBidXR0b24nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ2RhdGEtdm9pY2UnLCB2b2ljZS52b2ljZV9pZClcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCd0aXRsZScsIGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZURlbGV0ZSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJzxpIGNsYXNzPVwidHJhc2ggaWNvblwiPjwvaT4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uVm9pY2VVbmluc3RhbGwpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgJGFjdGlvbnMuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpLmFkZENsYXNzKCd1aSBzbWFsbCBwcmltYXJ5IGljb24gYnV0dG9uJylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCdkYXRhLXZvaWNlJywgdm9pY2Uudm9pY2VfaWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cigndGl0bGUnLCBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VJbnN0YWxsKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgnPGkgY2xhc3M9XCJkb3dubG9hZCBpY29uXCI+PC9pPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25Wb2ljZUluc3RhbGwpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICRyb3cuYXBwZW5kKCRhY3Rpb25zKTtcbiAgICAgICAgICAgICR0Ym9keS5hcHBlbmQoJHJvdyk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZW5kZXJWb2ljZVBpY2tlcigpIHtcbiAgICAgICAgY29uc3QgJHNlbGVjdCA9ICQoJyNwaHJhc2Utc3R1ZGlvLXZvaWNlJyk7XG4gICAgICAgIGNvbnN0IHByZXZpb3VzID0gJHNlbGVjdC52YWwoKTtcbiAgICAgICAgY29uc3QgZmFsbGJhY2sgPSAod2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzIHx8IHt9KS52b2ljZSB8fCAnJztcbiAgICAgICAgJHNlbGVjdC5lbXB0eSgpO1xuICAgICAgICBjb25zdCBpbnN0YWxsZWQgPSBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS52b2ljZXMuZmlsdGVyKCh2KSA9PiB2Lmluc3RhbGxlZCk7XG4gICAgICAgIGlmIChpbnN0YWxsZWQubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAkc2VsZWN0LmFwcGVuZCgkKCc8b3B0aW9uPicpLnZhbCgnJykudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fUGlja2VyRW1wdHkpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGluc3RhbGxlZC5mb3JFYWNoKCh2b2ljZSkgPT4ge1xuICAgICAgICAgICAgICAgICRzZWxlY3QuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAkKCc8b3B0aW9uPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAudmFsKHZvaWNlLnZvaWNlX2lkKVxuICAgICAgICAgICAgICAgICAgICAgICAgLnRleHQoYCR7dm9pY2UubGFuZ3VhZ2VfbGFiZWx9IOKAlCAke3ZvaWNlLnZvaWNlX25hbWV9ICgke3ZvaWNlLnF1YWxpdHl9KWApXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgICRzZWxlY3QuZHJvcGRvd24oe2Z1bGxUZXh0U2VhcmNoOiB0cnVlfSk7XG4gICAgICAgIGNvbnN0IHdhbnQgPSBwcmV2aW91cyB8fCBmYWxsYmFjaztcbiAgICAgICAgaWYgKHdhbnQpIHtcbiAgICAgICAgICAgICRzZWxlY3QuZHJvcGRvd24oJ3NldCBzZWxlY3RlZCcsIHdhbnQpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIG9uVm9pY2VJbnN0YWxsKCkge1xuICAgICAgICBjb25zdCAkYnRuID0gJCh0aGlzKTtcbiAgICAgICAgY29uc3Qgdm9pY2VJZCA9ICRidG4uZGF0YSgndm9pY2UnKTtcbiAgICAgICAgJGJ0bi5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VJbnN0YWxsLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBkYXRhOiBKU09OLnN0cmluZ2lmeSh7dm9pY2VfaWQ6IHZvaWNlSWR9KSxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKCgpID0+IHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VJbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIG9uVm9pY2VVbmluc3RhbGwoKSB7XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKHRoaXMpO1xuICAgICAgICBjb25zdCB2b2ljZUlkID0gJGJ0bi5kYXRhKCd2b2ljZScpO1xuICAgICAgICAkYnRuLmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IGAke3BocmFzZVN0dWRpb0luZGV4LmFwaS52b2ljZXN9LyR7ZW5jb2RlVVJJQ29tcG9uZW50KHZvaWNlSWQpfWAsXG4gICAgICAgICAgICBtZXRob2Q6ICdERUxFVEUnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgoKSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoVm9pY2VzKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvclZvaWNlVW5pbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIG9uR2VuZXJhdGUoKSB7XG4gICAgICAgIGNvbnN0IHRleHQgICAgICAgPSAoJCgnI3BocmFzZS1zdHVkaW8tdGV4dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIGNvbnN0IHZvaWNlSWQgICAgPSAkKCcjcGhyYXNlLXN0dWRpby12b2ljZScpLnZhbCgpIHx8ICcnO1xuICAgICAgICBjb25zdCBzYW1wbGVSYXRlID0gJCgnI3BocmFzZS1zdHVkaW8tc2FtcGxlLXJhdGUnKS52YWwoKSB8fCAnbmF0aXZlJztcbiAgICAgICAgaWYgKCF0ZXh0IHx8ICF2b2ljZUlkKSB7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZhbGlkYXRpb25NaXNzaW5nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCAkYnRuID0gJCgnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtYnV0dG9uJykuYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLnBocmFzZXMsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KHt0ZXh0LCB2b2ljZV9pZDogdm9pY2VJZCwgc2FtcGxlX3JhdGU6IHNhbXBsZVJhdGV9KSxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGE7XG4gICAgICAgICAgICBpZiAoIWRhdGEgfHwgIWRhdGEucGhyYXNlX2lkKSB7XG4gICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKHJlc3BvbnNlICYmIHJlc3BvbnNlLm1lc3NhZ2VzXG4gICAgICAgICAgICAgICAgICAgID8gcmVzcG9uc2UubWVzc2FnZXNcbiAgICAgICAgICAgICAgICAgICAgOiBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JHZW5lcmF0ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCQoJyNwaHJhc2Utc3R1ZGlvLXJlbWVtYmVyJykuaXMoJzpjaGVja2VkJykpIHtcbiAgICAgICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5wZXJzaXN0RGVmYXVsdHModm9pY2VJZCwgc2FtcGxlUmF0ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBTd2l0Y2ggdG8gSGlzdG9yeSB0YWIg4oCUIHRoZSBuZXcgcm93IGNhcnJpZXMgdGhlIHN0YW5kYXJkXG4gICAgICAgICAgICAvLyBTb3VuZEZpbGVzLXN0eWxlIHBsYXllciBzbyB0aGUgdXNlciBjYW4gbGlzdGVuIGFuZCBkb3dubG9hZFxuICAgICAgICAgICAgLy8gdGhlcmUuIEF2b2lkcyBkdXBsaWNhdGluZyB0aGUgcGxheWVyIFVJIG9uIHRoZSBTdHVkaW8gdGFiLlxuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKCkgPT4ge1xuICAgICAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRhYi1tZW51IC5pdGVtW2RhdGEtdGFiPWhpc3RvcnldJykudGFiKCdjaGFuZ2UgdGFiJywgJ2hpc3RvcnknKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JHZW5lcmF0ZSk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBwZXJzaXN0RGVmYXVsdHModm9pY2VJZCwgc2FtcGxlUmF0ZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkuc2F2ZURlZmF1bHRzLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBkYXRhOiB7ZGVmYXVsdF92b2ljZTogdm9pY2VJZCwgZGVmYXVsdF9zYW1wbGVfcmF0ZTogc2FtcGxlUmF0ZX0sXG4gICAgICAgIH0pLmRvbmUoKCkgPT4ge1xuICAgICAgICAgICAgd2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzID0ge3ZvaWNlOiB2b2ljZUlkLCBzYW1wbGVSYXRlfTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlZnJlc2hIaXN0b3J5KGNhbGxiYWNrKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5waHJhc2VzLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJIaXN0b3J5KChyZXNwb25zZSAmJiByZXNwb25zZS5kYXRhKSB8fCBbXSk7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckhpc3Rvcnkocm93cykge1xuICAgICAgICAvLyBUZWFyIGRvd24gRGF0YVRhYmxlICsgc291bmQgcGxheWVycyBmcm9tIHRoZSBwcmV2aW91cyByZW5kZXIuXG4gICAgICAgIGlmIChwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlXG4gICAgICAgICAgICAmJiAkLmZuLkRhdGFUYWJsZS5pc0RhdGFUYWJsZSgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpKSB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlLmRlc3Ryb3koKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmhpc3RvcnlEYXRhVGFibGUgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIE9iamVjdC52YWx1ZXMocGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuc291bmRQbGF5ZXJzKS5mb3JFYWNoKChwKSA9PiB7XG4gICAgICAgICAgICBpZiAocCAmJiBwLmh0bWw1QXVkaW8pIHtcbiAgICAgICAgICAgICAgICBwLmh0bWw1QXVkaW8ucGF1c2UoKTtcbiAgICAgICAgICAgICAgICBwLmh0bWw1QXVkaW8uc3JjID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5zb3VuZFBsYXllcnMgPSB7fTtcblxuICAgICAgICBjb25zdCAkdGJvZHkgPSAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlIHRib2R5JykuZW1wdHkoKTtcbiAgICAgICAgcm93cy5mb3JFYWNoKChyb3cpID0+IHtcbiAgICAgICAgICAgICR0Ym9keS5hcHBlbmQocGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVySGlzdG9yeVJvdyhyb3cpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJbml0aWFsaXNlIERhdGFUYWJsZSArIHNvdW5kIHBsYXllcnMsIG1pcnJvcmluZyBTb3VuZEZpbGVzIGluZGV4LlxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpLkRhdGFUYWJsZSh7XG4gICAgICAgICAgICBsZW5ndGhDaGFuZ2U6IGZhbHNlLFxuICAgICAgICAgICAgcGFnaW5nOiB0cnVlLFxuICAgICAgICAgICAgcGFnZUxlbmd0aDogMjUsXG4gICAgICAgICAgICBzZWFyY2hpbmc6IHRydWUsXG4gICAgICAgICAgICBpbmZvOiBmYWxzZSxcbiAgICAgICAgICAgIG9yZGVyaW5nOiB0cnVlLFxuICAgICAgICAgICAgbGFuZ3VhZ2U6IHR5cGVvZiBTZW1hbnRpY0xvY2FsaXphdGlvbiAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgICAgICAgICA/IFNlbWFudGljTG9jYWxpemF0aW9uLmRhdGFUYWJsZUxvY2FsaXNhdGlvblxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgb3JkZXI6IFtbMCwgJ2Rlc2MnXV0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJvd3MuZm9yRWFjaCgocm93KSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5zb3VuZFBsYXllcnNbcm93LmlkXSA9XG4gICAgICAgICAgICAgICAgbmV3IEluZGV4U291bmRQbGF5ZXIoYHBocmFzZS1yb3ctJHtyb3cuaWR9YCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5vbignY2xpY2snLCAnYnV0dG9uLmRlbGV0ZS1idXR0b24nLCBmdW5jdGlvbiBvbkRlbGV0ZShlKSB7XG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBjb25zdCBpZCA9ICQodGhpcykuZGF0YSgnaWQnKTtcbiAgICAgICAgICAgIGlmICghaWQpIHJldHVybjtcbiAgICAgICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICAgICAgdXJsOiBgJHtwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlc30vJHtpZH1gLFxuICAgICAgICAgICAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgIH0pLmRvbmUoKCkgPT4gcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKSlcbiAgICAgICAgICAgICAgLmZhaWwoKCkgPT4gVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckhpc3RvcnlEZWxldGUpKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckhpc3RvcnlSb3cocm93KSB7XG4gICAgICAgIGNvbnN0IGNyZWF0ZWQgID0gcm93LmNyZWF0ZWRfYXQgPyBuZXcgRGF0ZShyb3cuY3JlYXRlZF9hdCAqIDEwMDApLnRvTG9jYWxlU3RyaW5nKCkgOiAn4oCUJztcbiAgICAgICAgY29uc3QgdGV4dCAgICAgPSAocm93LnRleHQgfHwgJycpLnN1YnN0cmluZygwLCA4MCk7XG4gICAgICAgIGNvbnN0IHZvaWNlSWQgID0gcm93LnZvaWNlX2lkIHx8ICcnO1xuICAgICAgICBjb25zdCBwbGF5VXJsICA9IGAke3BocmFzZVN0dWRpb0luZGV4LmFwaS5waHJhc2VzfS8ke3Jvdy5pZH06ZG93bmxvYWRgO1xuICAgICAgICBjb25zdCBkbFVybCAgICA9IHBsYXlVcmw7XG4gICAgICAgIGNvbnN0IGZpbGVuYW1lID0gYHBocmFzZV8ke3Jvdy5pZH0ud2F2YDtcbiAgICAgICAgcmV0dXJuIGA8dHIgY2xhc3M9XCJmaWxlLXJvd1wiIGlkPVwicGhyYXNlLXJvdy0ke3Jvdy5pZH1cIiBkYXRhLXZhbHVlPVwiJHtwbGF5VXJsfVwiPlxuICAgICAgICAgICAgPHRkPiR7JCgnPGRpdj4nKS50ZXh0KGNyZWF0ZWQpLmh0bWwoKX08L3RkPlxuICAgICAgICAgICAgPHRkPjxpIGNsYXNzPVwiZmlsZSBhdWRpbyBvdXRsaW5lIGljb25cIj48L2k+JHskKCc8ZGl2PicpLnRleHQodGV4dCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQ+JHskKCc8ZGl2PicpLnRleHQodm9pY2VJZCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQgY2xhc3M9XCJzaXggd2lkZSBjZHItcGxheWVyIGhpZGUtb24tbW9iaWxlXCI+XG4gICAgICAgICAgICAgICAgPHRhYmxlPlxuICAgICAgICAgICAgICAgICAgICA8dHI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3M9XCJvbmUgd2lkZVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJ1aSB0aW55IGJhc2ljIGljb24gYnV0dG9uIHBsYXktYnV0dG9uXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpIGNsYXNzPVwidWkgaWNvbiBwbGF5XCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxhdWRpbyBwcmVsb2FkPVwibm9uZVwiIGlkPVwiYXVkaW8tcGxheWVyLXBocmFzZS1yb3ctJHtyb3cuaWR9XCIgZGF0YS1zcmM9XCIke3BsYXlVcmx9XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxzb3VyY2Ugc3JjPVwiXCIvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYXVkaW8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ1aSByYW5nZSBjZHItcGxheWVyXCI+PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj48c3BhbiBjbGFzcz1cImNkci1kdXJhdGlvblwiPjwvc3Bhbj48L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbiBkb3dubG9hZC1idXR0b25cIiBkYXRhLXZhbHVlPVwiJHtkbFVybH0/ZmlsZW5hbWU9JHtmaWxlbmFtZX1cIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJ1aSBpY29uIGRvd25sb2FkXCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgIDx0ZCBjbGFzcz1cImNvbGxhcHNpbmdcIj5cbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbnMgYWN0aW9uLWJ1dHRvbnNcIj5cbiAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInVpIGJ1dHRvbiBkZWxldGUtYnV0dG9uXCIgZGF0YS1pZD1cIiR7cm93LmlkfVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU9XCIke2dsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19IaXN0b3J5RGVsZXRlfVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJpY29uIHRyYXNoIHJlZFwiPjwvaT5cbiAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICA8L3RkPlxuICAgICAgICA8L3RyPmA7XG4gICAgfSxcbn07XG5cbiQoZG9jdW1lbnQpLnJlYWR5KCgpID0+IHtcbiAgICBwaHJhc2VTdHVkaW9JbmRleC5pbml0aWFsaXplKCk7XG59KTtcbiJdfQ==