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
    $('#phrase-studio-sample-rate').dropdown(); // Module disabled → page is read-only, skip REST polling and
    // disable the form inputs. Avoids the "failed to load voices"
    // error popup users got when opening a disabled module's page.

    if ((window.phraseStudioDefaults || {}).disabled) {
      $('#phrase-studio-generate-form :input,' + '#phrase-studio-generate-button').prop('disabled', true);
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNyYy9tb2R1bGUtcGhyYXNlLXN0dWRpby1pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBTSxpQkFBaUIsR0FBRztBQUN0QixFQUFBLEdBQUcsRUFBRTtBQUNELElBQUEsTUFBTSxFQUFTLDZDQURkO0FBRUQsSUFBQSxhQUFhLEVBQUUscURBRmQ7QUFHRCxJQUFBLE1BQU0sRUFBUyw2Q0FIZDtBQUlELElBQUEsWUFBWSxFQUFHLHFEQUpkO0FBS0QsSUFBQSxPQUFPLEVBQVEsOENBTGQ7QUFNRCxJQUFBLFlBQVksRUFBRyxhQUFhLEdBQUc7QUFOOUIsR0FEaUI7QUFVdEIsRUFBQSxLQUFLLEVBQUU7QUFDSCxJQUFBLE1BQU0sRUFBRSxJQURMO0FBRUgsSUFBQSxNQUFNLEVBQUUsRUFGTDtBQUdILElBQUEsWUFBWSxFQUFFLEVBSFg7QUFJSCxJQUFBLGdCQUFnQixFQUFFO0FBSmYsR0FWZTtBQWlCdEIsRUFBQSxVQWpCc0Isd0JBaUJUO0FBQ1QsSUFBQSxDQUFDLENBQUMsK0JBQUQsQ0FBRCxDQUFtQyxHQUFuQztBQUNBLElBQUEsQ0FBQyxDQUFDLGtDQUFELENBQUQsQ0FBc0MsUUFBdEM7QUFDQSxJQUFBLENBQUMsQ0FBQyw0QkFBRCxDQUFELENBQWdDLFFBQWhDLEdBSFMsQ0FLVDtBQUNBO0FBQ0E7O0FBQ0EsUUFBSSxDQUFDLE1BQU0sQ0FBQyxvQkFBUCxJQUErQixFQUFoQyxFQUFvQyxRQUF4QyxFQUFrRDtBQUM5QyxNQUFBLENBQUMsQ0FBQyx5Q0FDSSxnQ0FETCxDQUFELENBQ3dDLElBRHhDLENBQzZDLFVBRDdDLEVBQ3lELElBRHpEO0FBRUE7QUFDSDs7QUFFRCxJQUFBLENBQUMsQ0FBQyxxQkFBRCxDQUFELENBQXlCLEVBQXpCLENBQTRCLE9BQTVCLEVBQXFDLGlCQUFpQixDQUFDLGFBQXZEO0FBQ0EsSUFBQSxDQUFDLENBQUMsZ0NBQUQsQ0FB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QWhCLEVBQXlCLElBQXpCLEVBRFYsNkVBRWlELENBQUMsQ0FBQyxPQUFELENBQUQsQ0FBVyxJQUFYLENBQWdCLElBQWhCLEVBQXNCLElBQXRCLEVBRmpELG9DQUdVLENBQUMsQ0FBQyxPQUFELENBQUQsQ0FBVyxJQUFYLENBQWdCLE9BQWhCLEVBQXlCLElBQXpCLEVBSFYscWNBV3dFLEdBQUcsQ0FBQyxFQVg1RSwyQkFXNkYsT0FYN0YsK2ZBb0I0RixLQXBCNUYsdUJBb0I4RyxRQXBCOUcsOFpBNkIrRCxHQUFHLENBQUMsRUE3Qm5FLHFEQThCNkIsZUFBZSxDQUFDLGtDQTlCN0M7QUFvQ0g7QUFqWnFCLENBQTFCO0FBb1pBLENBQUMsQ0FBQyxRQUFELENBQUQsQ0FBWSxLQUFaLENBQWtCLFlBQU07QUFDcEIsRUFBQSxpQkFBaUIsQ0FBQyxVQUFsQjtBQUNILENBRkQiLCJmaWxlIjoibW9kdWxlLXBocmFzZS1zdHVkaW8taW5kZXguanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiBnbG9iYWwgJCwgZ2xvYmFsUm9vdFVybCwgZ2xvYmFsVHJhbnNsYXRlLCBQYnhBcGksIFVzZXJNZXNzYWdlLCBJbmRleFNvdW5kUGxheWVyLCBUb2tlbk1hbmFnZXIsIFNlbWFudGljTG9jYWxpemF0aW9uICovXG5cbi8qKlxuICogU3R1ZGlvIHBhZ2UgY29udHJvbGxlciBmb3IgTW9kdWxlUGhyYXNlU3R1ZGlvLlxuICpcbiAqIFRoZSBwYWdlIGhhcyBmb3VyIHRhYnMgKHN0dWRpbyAvIHZvaWNlcyAvIGVuZ2luZSAvIGhpc3RvcnkpLiBBbGwgZGF0YSBmbG93c1xuICogdGhyb3VnaCB0aGUgbW9kdWxlJ3MgUkVTVCB2MyBlbmRwb2ludHMgdW5kZXIgL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvLlxuICogV2UgcmVseSBvbiBQYnhBcGkuY2FsbEpzb25SZXN0IGhlbHBlciwgd2hpY2ggYWxyZWFkeSBoYW5kbGVzIGF1dGggaGVhZGVycy5cbiAqL1xuY29uc3QgcGhyYXNlU3R1ZGlvSW5kZXggPSB7XG4gICAgYXBpOiB7XG4gICAgICAgIGVuZ2luZTogICAgICAgICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vZW5naW5lJyxcbiAgICAgICAgZW5naW5lSW5zdGFsbDogJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby9lbmdpbmU6aW5zdGFsbCcsXG4gICAgICAgIHZvaWNlczogICAgICAgICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vdm9pY2VzJyxcbiAgICAgICAgdm9pY2VJbnN0YWxsOiAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby92b2ljZXM6aW5zdGFsbCcsXG4gICAgICAgIHBocmFzZXM6ICAgICAgICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vcGhyYXNlcycsXG4gICAgICAgIHNhdmVEZWZhdWx0czogIGdsb2JhbFJvb3RVcmwgKyAnbW9kdWxlLXBocmFzZS1zdHVkaW8vbW9kdWxlLXBocmFzZS1zdHVkaW8vc2F2ZScsXG4gICAgfSxcblxuICAgIHN0YXRlOiB7XG4gICAgICAgIGVuZ2luZTogbnVsbCxcbiAgICAgICAgdm9pY2VzOiBbXSxcbiAgICAgICAgc291bmRQbGF5ZXJzOiB7fSxcbiAgICAgICAgaGlzdG9yeURhdGFUYWJsZTogbnVsbCxcbiAgICB9LFxuXG4gICAgaW5pdGlhbGl6ZSgpIHtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tdGFiLW1lbnUgLml0ZW0nKS50YWIoKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tcmVtZW1iZXItY2hlY2tib3gnKS5jaGVja2JveCgpO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1zYW1wbGUtcmF0ZScpLmRyb3Bkb3duKCk7XG5cbiAgICAgICAgLy8gTW9kdWxlIGRpc2FibGVkIOKGkiBwYWdlIGlzIHJlYWQtb25seSwgc2tpcCBSRVNUIHBvbGxpbmcgYW5kXG4gICAgICAgIC8vIGRpc2FibGUgdGhlIGZvcm0gaW5wdXRzLiBBdm9pZHMgdGhlIFwiZmFpbGVkIHRvIGxvYWQgdm9pY2VzXCJcbiAgICAgICAgLy8gZXJyb3IgcG9wdXAgdXNlcnMgZ290IHdoZW4gb3BlbmluZyBhIGRpc2FibGVkIG1vZHVsZSdzIHBhZ2UuXG4gICAgICAgIGlmICgod2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzIHx8IHt9KS5kaXNhYmxlZCkge1xuICAgICAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtZm9ybSA6aW5wdXQsJ1xuICAgICAgICAgICAgICAgICsgJyNwaHJhc2Utc3R1ZGlvLWdlbmVyYXRlLWJ1dHRvbicpLnByb3AoJ2Rpc2FibGVkJywgdHJ1ZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0Jykub24oJ2lucHV0JywgcGhyYXNlU3R1ZGlvSW5kZXgudXBkYXRlQ291bnRlcik7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWdlbmVyYXRlLWJ1dHRvbicpLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uR2VuZXJhdGUpO1xuICAgICAgICAkKCdbZGF0YS10YWI9XCJ2b2ljZXNcIl0nKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoVm9pY2VzKTtcbiAgICAgICAgJCgnW2RhdGEtdGFiPVwiZW5naW5lXCJdJykub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEVuZ2luZSk7XG4gICAgICAgICQoJ1tkYXRhLXRhYj1cImhpc3RvcnlcIl0nKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoSGlzdG9yeSk7XG5cbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguYXBwbHlEZWZhdWx0cygpO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKCk7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMoKTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKTtcbiAgICB9LFxuXG4gICAgYXBwbHlEZWZhdWx0cygpIHtcbiAgICAgICAgY29uc3QgZCA9IHdpbmRvdy5waHJhc2VTdHVkaW9EZWZhdWx0cyB8fCB7fTtcbiAgICAgICAgaWYgKGQuc2FtcGxlUmF0ZSkge1xuICAgICAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tc2FtcGxlLXJhdGUnKS5kcm9wZG93bignc2V0IHNlbGVjdGVkJywgZC5zYW1wbGVSYXRlKTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGVDb3VudGVyKCkge1xuICAgICAgICBjb25zdCB2YWx1ZSA9ICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS52YWwoKSB8fCAnJztcbiAgICAgICAgY29uc3QgbWF4ICAgPSBwYXJzZUludCgkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykuYXR0cignbWF4bGVuZ3RoJykgfHwgJzgwMCcsIDEwKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tdGV4dC1jb3VudGVyJykudGV4dChgJHt2YWx1ZS5sZW5ndGh9IC8gJHttYXh9YCk7XG4gICAgfSxcblxuICAgIHJlZnJlc2hFbmdpbmUoKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5lbmdpbmUsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmVuZ2luZSA9IChyZXNwb25zZSAmJiByZXNwb25zZS5kYXRhKSB8fCBudWxsO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVyRW5naW5lKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckVuZ2luZVN0YXR1cyk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZW5kZXJFbmdpbmUoKSB7XG4gICAgICAgIGNvbnN0ICRib3ggPSAkKCcjcGhyYXNlLXN0dWRpby1lbmdpbmUtc3RhdHVzJykuZW1wdHkoKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmVuZ2luZSB8fCB7fTtcbiAgICAgICAgaWYgKGRhdGEuaW5zdGFsbGVkKSB7XG4gICAgICAgICAgICAkYm94LmFwcGVuZChcbiAgICAgICAgICAgICAgICAkKCc8ZGl2PicpLmFkZENsYXNzKCd1aSBwb3NpdGl2ZSBtZXNzYWdlJylcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgkKCc8ZGl2PicpLmFkZENsYXNzKCdoZWFkZXInKS50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVJbnN0YWxsZWQpKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCQoJzxwPicpLnRleHQoYCR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZVZlcnNpb259OiAke2RhdGEudmVyc2lvbiB8fCAn4oCUJ31gKSlcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgICAgICQoJzxidXR0b24+JylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuYWRkQ2xhc3MoJ3VpIHNtYWxsIHJlZCBiYXNpYyBidXR0b24nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVVbmluc3RhbGwpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uRW5naW5lVW5pbnN0YWxsKVxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJGJveC5hcHBlbmQoXG4gICAgICAgICAgICAgICAgJCgnPGRpdj4nKS5hZGRDbGFzcygndWkgd2FybmluZyBtZXNzYWdlJylcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgkKCc8ZGl2PicpLmFkZENsYXNzKCdoZWFkZXInKS50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVOb3RJbnN0YWxsZWQpKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCQoJzxwPicpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZUluc3RhbGxIaW50KSlcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgICAgICQoJzxidXR0b24+JylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuYWRkQ2xhc3MoJ3VpIHByaW1hcnkgYnV0dG9uJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lSW5zdGFsbClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25FbmdpbmVJbnN0YWxsKVxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIG9uRW5naW5lSW5zdGFsbCgpIHtcbiAgICAgICAgY29uc3QgJGJ0biA9ICQodGhpcyk7XG4gICAgICAgICRidG4uYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLmVuZ2luZUluc3RhbGwsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKCk7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhyZXNwb25zZS5tZXNzYWdlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckVuZ2luZUluc3RhbGwpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgb25FbmdpbmVVbmluc3RhbGwoKSB7XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKHRoaXMpO1xuICAgICAgICAkYnRuLmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5lbmdpbmUsXG4gICAgICAgICAgICBtZXRob2Q6ICdERUxFVEUnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckVuZ2luZVVuaW5zdGFsbCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZWZyZXNoVm9pY2VzKCkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VzLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS52b2ljZXMgPSAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSkgfHwgW107XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJWb2ljZXNUYWJsZSgpO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVyVm9pY2VQaWNrZXIoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VzTGlzdCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZW5kZXJWb2ljZXNUYWJsZSgpIHtcbiAgICAgICAgY29uc3QgJHRib2R5ID0gJCgnI3BocmFzZS1zdHVkaW8tdm9pY2VzLXRhYmxlIHRib2R5JykuZW1wdHkoKTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzLmZvckVhY2goKHZvaWNlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCAkcm93ID0gJCgnPHRyPicpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQoYCR7dm9pY2UubGFuZ3VhZ2VfbGFiZWx9ICgke3ZvaWNlLmxhbmd1YWdlfSlgKSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykudGV4dCh2b2ljZS52b2ljZV9uYW1lKSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykudGV4dCh2b2ljZS5xdWFsaXR5KSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykudGV4dChgJHt2b2ljZS5zYW1wbGVfcmF0ZX0gSHpgKSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykuaHRtbCh2b2ljZS5pbnN0YWxsZWRcbiAgICAgICAgICAgICAgICA/IGA8c3BhbiBjbGFzcz1cInVpIGdyZWVuIGxhYmVsXCI+JHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VJbnN0YWxsZWR9PC9zcGFuPmBcbiAgICAgICAgICAgICAgICA6IGA8c3BhbiBjbGFzcz1cInVpIGxhYmVsXCI+JHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VOb3RJbnN0YWxsZWR9PC9zcGFuPmApKTtcbiAgICAgICAgICAgIGNvbnN0ICRhY3Rpb25zID0gJCgnPHRkPicpLmFkZENsYXNzKCdyaWdodCBhbGlnbmVkJyk7XG4gICAgICAgICAgICBpZiAodm9pY2UuaW5zdGFsbGVkKSB7XG4gICAgICAgICAgICAgICAgJGFjdGlvbnMuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpLmFkZENsYXNzKCd1aSBzbWFsbCBiYXNpYyByZWQgaWNvbiBidXR0b24nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ2RhdGEtdm9pY2UnLCB2b2ljZS52b2ljZV9pZClcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCd0aXRsZScsIGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZURlbGV0ZSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJzxpIGNsYXNzPVwidHJhc2ggaWNvblwiPjwvaT4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uVm9pY2VVbmluc3RhbGwpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgJGFjdGlvbnMuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpLmFkZENsYXNzKCd1aSBzbWFsbCBwcmltYXJ5IGljb24gYnV0dG9uJylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCdkYXRhLXZvaWNlJywgdm9pY2Uudm9pY2VfaWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cigndGl0bGUnLCBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VJbnN0YWxsKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgnPGkgY2xhc3M9XCJkb3dubG9hZCBpY29uXCI+PC9pPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25Wb2ljZUluc3RhbGwpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICRyb3cuYXBwZW5kKCRhY3Rpb25zKTtcbiAgICAgICAgICAgICR0Ym9keS5hcHBlbmQoJHJvdyk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZW5kZXJWb2ljZVBpY2tlcigpIHtcbiAgICAgICAgY29uc3QgJHNlbGVjdCA9ICQoJyNwaHJhc2Utc3R1ZGlvLXZvaWNlJyk7XG4gICAgICAgIGNvbnN0IHByZXZpb3VzID0gJHNlbGVjdC52YWwoKTtcbiAgICAgICAgY29uc3QgZmFsbGJhY2sgPSAod2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzIHx8IHt9KS52b2ljZSB8fCAnJztcbiAgICAgICAgJHNlbGVjdC5lbXB0eSgpO1xuICAgICAgICBjb25zdCBpbnN0YWxsZWQgPSBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS52b2ljZXMuZmlsdGVyKCh2KSA9PiB2Lmluc3RhbGxlZCk7XG4gICAgICAgIGlmIChpbnN0YWxsZWQubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAkc2VsZWN0LmFwcGVuZCgkKCc8b3B0aW9uPicpLnZhbCgnJykudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fUGlja2VyRW1wdHkpKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGluc3RhbGxlZC5mb3JFYWNoKCh2b2ljZSkgPT4ge1xuICAgICAgICAgICAgICAgICRzZWxlY3QuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAkKCc8b3B0aW9uPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAudmFsKHZvaWNlLnZvaWNlX2lkKVxuICAgICAgICAgICAgICAgICAgICAgICAgLnRleHQoYCR7dm9pY2UubGFuZ3VhZ2VfbGFiZWx9IOKAlCAke3ZvaWNlLnZvaWNlX25hbWV9ICgke3ZvaWNlLnF1YWxpdHl9KWApXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICAgICRzZWxlY3QuZHJvcGRvd24oe2Z1bGxUZXh0U2VhcmNoOiB0cnVlfSk7XG4gICAgICAgIGNvbnN0IHdhbnQgPSBwcmV2aW91cyB8fCBmYWxsYmFjaztcbiAgICAgICAgaWYgKHdhbnQpIHtcbiAgICAgICAgICAgICRzZWxlY3QuZHJvcGRvd24oJ3NldCBzZWxlY3RlZCcsIHdhbnQpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIG9uVm9pY2VJbnN0YWxsKCkge1xuICAgICAgICBjb25zdCAkYnRuID0gJCh0aGlzKTtcbiAgICAgICAgY29uc3Qgdm9pY2VJZCA9ICRidG4uZGF0YSgndm9pY2UnKTtcbiAgICAgICAgJGJ0bi5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VJbnN0YWxsLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBkYXRhOiBKU09OLnN0cmluZ2lmeSh7dm9pY2VfaWQ6IHZvaWNlSWR9KSxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKCgpID0+IHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VJbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIG9uVm9pY2VVbmluc3RhbGwoKSB7XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKHRoaXMpO1xuICAgICAgICBjb25zdCB2b2ljZUlkID0gJGJ0bi5kYXRhKCd2b2ljZScpO1xuICAgICAgICAkYnRuLmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IGAke3BocmFzZVN0dWRpb0luZGV4LmFwaS52b2ljZXN9LyR7ZW5jb2RlVVJJQ29tcG9uZW50KHZvaWNlSWQpfWAsXG4gICAgICAgICAgICBtZXRob2Q6ICdERUxFVEUnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgoKSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoVm9pY2VzKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvclZvaWNlVW5pbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIG9uR2VuZXJhdGUoKSB7XG4gICAgICAgIGNvbnN0IHRleHQgICAgICAgPSAoJCgnI3BocmFzZS1zdHVkaW8tdGV4dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIGNvbnN0IHZvaWNlSWQgICAgPSAkKCcjcGhyYXNlLXN0dWRpby12b2ljZScpLnZhbCgpIHx8ICcnO1xuICAgICAgICBjb25zdCBzYW1wbGVSYXRlID0gJCgnI3BocmFzZS1zdHVkaW8tc2FtcGxlLXJhdGUnKS52YWwoKSB8fCAnbmF0aXZlJztcbiAgICAgICAgaWYgKCF0ZXh0IHx8ICF2b2ljZUlkKSB7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZhbGlkYXRpb25NaXNzaW5nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCAkYnRuID0gJCgnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtYnV0dG9uJykuYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLnBocmFzZXMsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KHt0ZXh0LCB2b2ljZV9pZDogdm9pY2VJZCwgc2FtcGxlX3JhdGU6IHNhbXBsZVJhdGV9KSxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGE7XG4gICAgICAgICAgICBpZiAoIWRhdGEgfHwgIWRhdGEucGhyYXNlX2lkKSB7XG4gICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKHJlc3BvbnNlICYmIHJlc3BvbnNlLm1lc3NhZ2VzXG4gICAgICAgICAgICAgICAgICAgID8gcmVzcG9uc2UubWVzc2FnZXNcbiAgICAgICAgICAgICAgICAgICAgOiBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JHZW5lcmF0ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCQoJyNwaHJhc2Utc3R1ZGlvLXJlbWVtYmVyJykuaXMoJzpjaGVja2VkJykpIHtcbiAgICAgICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5wZXJzaXN0RGVmYXVsdHModm9pY2VJZCwgc2FtcGxlUmF0ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBTd2l0Y2ggdG8gSGlzdG9yeSB0YWIg4oCUIHRoZSBuZXcgcm93IGNhcnJpZXMgdGhlIHN0YW5kYXJkXG4gICAgICAgICAgICAvLyBTb3VuZEZpbGVzLXN0eWxlIHBsYXllciBzbyB0aGUgdXNlciBjYW4gbGlzdGVuIGFuZCBkb3dubG9hZFxuICAgICAgICAgICAgLy8gdGhlcmUuIEF2b2lkcyBkdXBsaWNhdGluZyB0aGUgcGxheWVyIFVJIG9uIHRoZSBTdHVkaW8gdGFiLlxuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKCkgPT4ge1xuICAgICAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRhYi1tZW51IC5pdGVtW2RhdGEtdGFiPWhpc3RvcnldJykudGFiKCdjaGFuZ2UgdGFiJywgJ2hpc3RvcnknKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JHZW5lcmF0ZSk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBwZXJzaXN0RGVmYXVsdHModm9pY2VJZCwgc2FtcGxlUmF0ZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkuc2F2ZURlZmF1bHRzLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBkYXRhOiB7ZGVmYXVsdF92b2ljZTogdm9pY2VJZCwgZGVmYXVsdF9zYW1wbGVfcmF0ZTogc2FtcGxlUmF0ZX0sXG4gICAgICAgIH0pLmRvbmUoKCkgPT4ge1xuICAgICAgICAgICAgd2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzID0ge3ZvaWNlOiB2b2ljZUlkLCBzYW1wbGVSYXRlfTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlZnJlc2hIaXN0b3J5KGNhbGxiYWNrKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5waHJhc2VzLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJIaXN0b3J5KChyZXNwb25zZSAmJiByZXNwb25zZS5kYXRhKSB8fCBbXSk7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckhpc3Rvcnkocm93cykge1xuICAgICAgICAvLyBUZWFyIGRvd24gRGF0YVRhYmxlICsgc291bmQgcGxheWVycyBmcm9tIHRoZSBwcmV2aW91cyByZW5kZXIuXG4gICAgICAgIGlmIChwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlXG4gICAgICAgICAgICAmJiAkLmZuLkRhdGFUYWJsZS5pc0RhdGFUYWJsZSgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpKSB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlLmRlc3Ryb3koKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmhpc3RvcnlEYXRhVGFibGUgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIE9iamVjdC52YWx1ZXMocGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuc291bmRQbGF5ZXJzKS5mb3JFYWNoKChwKSA9PiB7XG4gICAgICAgICAgICBpZiAocCAmJiBwLmh0bWw1QXVkaW8pIHtcbiAgICAgICAgICAgICAgICBwLmh0bWw1QXVkaW8ucGF1c2UoKTtcbiAgICAgICAgICAgICAgICBwLmh0bWw1QXVkaW8uc3JjID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5zb3VuZFBsYXllcnMgPSB7fTtcblxuICAgICAgICBjb25zdCAkdGJvZHkgPSAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlIHRib2R5JykuZW1wdHkoKTtcbiAgICAgICAgcm93cy5mb3JFYWNoKChyb3cpID0+IHtcbiAgICAgICAgICAgICR0Ym9keS5hcHBlbmQocGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVySGlzdG9yeVJvdyhyb3cpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJbml0aWFsaXNlIERhdGFUYWJsZSArIHNvdW5kIHBsYXllcnMsIG1pcnJvcmluZyBTb3VuZEZpbGVzIGluZGV4LlxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpLkRhdGFUYWJsZSh7XG4gICAgICAgICAgICBsZW5ndGhDaGFuZ2U6IGZhbHNlLFxuICAgICAgICAgICAgcGFnaW5nOiB0cnVlLFxuICAgICAgICAgICAgcGFnZUxlbmd0aDogMjUsXG4gICAgICAgICAgICBzZWFyY2hpbmc6IHRydWUsXG4gICAgICAgICAgICBpbmZvOiBmYWxzZSxcbiAgICAgICAgICAgIG9yZGVyaW5nOiB0cnVlLFxuICAgICAgICAgICAgbGFuZ3VhZ2U6IHR5cGVvZiBTZW1hbnRpY0xvY2FsaXphdGlvbiAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgICAgICAgICA/IFNlbWFudGljTG9jYWxpemF0aW9uLmRhdGFUYWJsZUxvY2FsaXNhdGlvblxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgb3JkZXI6IFtbMCwgJ2Rlc2MnXV0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJvd3MuZm9yRWFjaCgocm93KSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5zb3VuZFBsYXllcnNbcm93LmlkXSA9XG4gICAgICAgICAgICAgICAgbmV3IEluZGV4U291bmRQbGF5ZXIoYHBocmFzZS1yb3ctJHtyb3cuaWR9YCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5vbignY2xpY2snLCAnYnV0dG9uLmRlbGV0ZS1idXR0b24nLCBmdW5jdGlvbiBvbkRlbGV0ZShlKSB7XG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBjb25zdCBpZCA9ICQodGhpcykuZGF0YSgnaWQnKTtcbiAgICAgICAgICAgIGlmICghaWQpIHJldHVybjtcbiAgICAgICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICAgICAgdXJsOiBgJHtwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlc30vJHtpZH1gLFxuICAgICAgICAgICAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgIH0pLmRvbmUoKCkgPT4gcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKSlcbiAgICAgICAgICAgICAgLmZhaWwoKCkgPT4gVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckhpc3RvcnlEZWxldGUpKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckhpc3RvcnlSb3cocm93KSB7XG4gICAgICAgIGNvbnN0IGNyZWF0ZWQgID0gcm93LmNyZWF0ZWRfYXQgPyBuZXcgRGF0ZShyb3cuY3JlYXRlZF9hdCAqIDEwMDApLnRvTG9jYWxlU3RyaW5nKCkgOiAn4oCUJztcbiAgICAgICAgY29uc3QgdGV4dCAgICAgPSAocm93LnRleHQgfHwgJycpLnN1YnN0cmluZygwLCA4MCk7XG4gICAgICAgIGNvbnN0IHZvaWNlSWQgID0gcm93LnZvaWNlX2lkIHx8ICcnO1xuICAgICAgICBjb25zdCBwbGF5VXJsICA9IGAke3BocmFzZVN0dWRpb0luZGV4LmFwaS5waHJhc2VzfS8ke3Jvdy5pZH06ZG93bmxvYWRgO1xuICAgICAgICBjb25zdCBkbFVybCAgICA9IHBsYXlVcmw7XG4gICAgICAgIGNvbnN0IGZpbGVuYW1lID0gYHBocmFzZV8ke3Jvdy5pZH0ud2F2YDtcbiAgICAgICAgcmV0dXJuIGA8dHIgY2xhc3M9XCJmaWxlLXJvd1wiIGlkPVwicGhyYXNlLXJvdy0ke3Jvdy5pZH1cIiBkYXRhLXZhbHVlPVwiJHtwbGF5VXJsfVwiPlxuICAgICAgICAgICAgPHRkPiR7JCgnPGRpdj4nKS50ZXh0KGNyZWF0ZWQpLmh0bWwoKX08L3RkPlxuICAgICAgICAgICAgPHRkPjxpIGNsYXNzPVwiZmlsZSBhdWRpbyBvdXRsaW5lIGljb25cIj48L2k+JHskKCc8ZGl2PicpLnRleHQodGV4dCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQ+JHskKCc8ZGl2PicpLnRleHQodm9pY2VJZCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQgY2xhc3M9XCJzaXggd2lkZSBjZHItcGxheWVyIGhpZGUtb24tbW9iaWxlXCI+XG4gICAgICAgICAgICAgICAgPHRhYmxlPlxuICAgICAgICAgICAgICAgICAgICA8dHI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3M9XCJvbmUgd2lkZVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJ1aSB0aW55IGJhc2ljIGljb24gYnV0dG9uIHBsYXktYnV0dG9uXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpIGNsYXNzPVwidWkgaWNvbiBwbGF5XCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxhdWRpbyBwcmVsb2FkPVwibm9uZVwiIGlkPVwiYXVkaW8tcGxheWVyLXBocmFzZS1yb3ctJHtyb3cuaWR9XCIgZGF0YS1zcmM9XCIke3BsYXlVcmx9XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxzb3VyY2Ugc3JjPVwiXCIvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYXVkaW8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ1aSByYW5nZSBjZHItcGxheWVyXCI+PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj48c3BhbiBjbGFzcz1cImNkci1kdXJhdGlvblwiPjwvc3Bhbj48L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbiBkb3dubG9hZC1idXR0b25cIiBkYXRhLXZhbHVlPVwiJHtkbFVybH0/ZmlsZW5hbWU9JHtmaWxlbmFtZX1cIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJ1aSBpY29uIGRvd25sb2FkXCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgIDx0ZCBjbGFzcz1cImNvbGxhcHNpbmdcIj5cbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbnMgYWN0aW9uLWJ1dHRvbnNcIj5cbiAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInVpIGJ1dHRvbiBkZWxldGUtYnV0dG9uXCIgZGF0YS1pZD1cIiR7cm93LmlkfVwiXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU9XCIke2dsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19IaXN0b3J5RGVsZXRlfVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJpY29uIHRyYXNoIHJlZFwiPjwvaT5cbiAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICA8L3RkPlxuICAgICAgICA8L3RyPmA7XG4gICAgfSxcbn07XG5cbiQoZG9jdW1lbnQpLnJlYWR5KCgpID0+IHtcbiAgICBwaHJhc2VTdHVkaW9JbmRleC5pbml0aWFsaXplKCk7XG59KTtcbiJdfQ==