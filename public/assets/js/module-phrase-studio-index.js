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
    }).done(function (response) {
      if (response && response.result === false) {
        $btn.removeClass('loading disabled');
        UserMessage.showMultiString(response.messages || globalTranslate.module_phrase_studio_ErrorVoiceInstall);
        return;
      }

      UserMessage.showInformation("".concat(globalTranslate.module_phrase_studio_VoiceInstalled_Toast, ": ").concat(voiceId));
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
      UserMessage.showInformation("".concat(globalTranslate.module_phrase_studio_VoiceUninstalled_Toast, ": ").concat(voiceId));
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
      } // History table lives right under the form on the Studio tab,
      // so a refresh is enough — no tab switch.


      phraseStudioIndex.refreshHistory();
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
    var $tableWrap = $('#phrase-studio-history-table').closest('.dataTables_wrapper');

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
    }); // Standard MikoPBX two-step delete (delete-something.js) flips the
    // 'two-steps-delete' class off on the first click. We listen for the
    // *second* click (when the class is gone) to fire the REST DELETE.

    $('body').off('click.phraseStudio');
    $('body').on('click.phraseStudio', 'a.delete:not(.two-steps-delete)', function onConfirmedDelete(e) {
      var $target = $(e.target).closest('a.delete');

      if ($target.closest('#phrase-studio-history-table').length === 0) {
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();
      var id = $target.attr('data-value');
      if (!id) return;
      $target.addClass('loading disabled');
      $.ajax({
        url: "".concat(phraseStudioIndex.api.phrases, "/").concat(id),
        method: 'DELETE',
        dataType: 'json'
      }).done(function () {
        return phraseStudioIndex.refreshHistory();
      }).fail(function () {
        $target.removeClass('loading disabled');
        UserMessage.showMultiString(globalTranslate.module_phrase_studio_ErrorHistoryDelete);
      });
    });
    var $tbl = $('#phrase-studio-history-table');
    $tbl.find('.popuped').popup(); // Click on the text cell → copy phrase text + voice back into the form
    // so the user can edit and re-generate without retyping. Keeps the
    // player / download / delete buttons clickable on their own.

    $tbl.off('click.phraseStudio');
    $tbl.on('click.phraseStudio', 'td.phrase-reuse', function onReuse() {
      var $row = $(this).closest('tr');
      var text = $row.attr('data-text') || '';
      var voice = $row.attr('data-voice') || '';
      $('#phrase-studio-text').val(text).trigger('input');

      if (voice) {
        $('#phrase-studio-voice').dropdown('set selected', voice);
      }

      $('html, body').animate({
        scrollTop: $('#phrase-studio-text').offset().top - 80
      }, 200);
      $('#phrase-studio-text').focus();
    });
  },
  renderHistoryRow: function renderHistoryRow(row) {
    var created = row.created_at ? new Date(row.created_at * 1000).toLocaleString() : '—';
    var fullText = row.text || '';
    var shortText = fullText.length > 80 ? "".concat(fullText.substring(0, 80), "\u2026") : fullText;
    var voiceId = row.voice_id || '';
    var playUrl = "".concat(phraseStudioIndex.api.phrases, "/").concat(row.id, ":download");
    var dlUrl = playUrl;
    var filename = "phrase_".concat(row.id, ".wav");
    var tooltip = globalTranslate.module_phrase_studio_RowReuseTooltip || '';

    var escAttr = function escAttr(s) {
      return $('<div>').text(s).html().replace(/"/g, '&quot;');
    };

    return "<tr class=\"file-row\" id=\"phrase-row-".concat(row.id, "\"\n                    data-value=\"").concat(playUrl, "\"\n                    data-text=\"").concat(escAttr(fullText), "\"\n                    data-voice=\"").concat(escAttr(voiceId), "\">\n            <td>").concat($('<div>').text(created).html(), "</td>\n            <td class=\"phrase-reuse\" style=\"cursor:pointer\" title=\"").concat(escAttr(tooltip), "\">\n                <i class=\"file audio outline icon\"></i>").concat($('<div>').text(shortText).html(), "\n            </td>\n            <td>").concat($('<div>').text(voiceId).html(), "</td>\n            <td class=\"six wide cdr-player hide-on-mobile\">\n                <table>\n                    <tr>\n                        <td class=\"one wide\">\n                            <button class=\"ui tiny basic icon button play-button\">\n                                <i class=\"ui icon play\"></i>\n                            </button>\n                            <audio preload=\"none\" id=\"audio-player-phrase-row-").concat(row.id, "\" data-src=\"").concat(playUrl, "\">\n                                <source src=\"\"/>\n                            </audio>\n                        </td>\n                        <td>\n                            <div class=\"ui range cdr-player\"></div>\n                        </td>\n                        <td class=\"one wide\"><span class=\"cdr-duration\"></span></td>\n                        <td class=\"one wide\">\n                            <button class=\"ui tiny basic icon button download-button\" data-value=\"").concat(dlUrl, "?filename=").concat(filename, "\">\n                                <i class=\"ui icon download\"></i>\n                            </button>\n                        </td>\n                    </tr>\n                </table>\n            </td>\n            <td class=\"collapsing\">\n                <div class=\"ui tiny basic icon buttons action-buttons\">\n                    <a href=\"#\" data-value=\"").concat(row.id, "\"\n                       class=\"ui button delete two-steps-delete popuped\"\n                       data-content=\"").concat(escAttr(globalTranslate.module_phrase_studio_HistoryDelete), "\">\n                        <i class=\"icon trash red\"></i>\n                    </a>\n                </div>\n            </td>\n        </tr>");
  }
};
$(document).ready(function () {
  phraseStudioIndex.initialize();
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNyYy9tb2R1bGUtcGhyYXNlLXN0dWRpby1pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBTSxpQkFBaUIsR0FBRztBQUN0QixFQUFBLEdBQUcsRUFBRTtBQUNELElBQUEsTUFBTSxFQUFTLDZDQURkO0FBRUQsSUFBQSxhQUFhLEVBQUUscURBRmQ7QUFHRCxJQUFBLE1BQU0sRUFBUyw2Q0FIZDtBQUlELElBQUEsWUFBWSxFQUFHLHFEQUpkO0FBS0QsSUFBQSxPQUFPLEVBQVEsOENBTGQ7QUFNRCxJQUFBLFlBQVksRUFBRyxhQUFhLEdBQUc7QUFOOUIsR0FEaUI7QUFVdEIsRUFBQSxLQUFLLEVBQUU7QUFDSCxJQUFBLE1BQU0sRUFBRSxJQURMO0FBRUgsSUFBQSxNQUFNLEVBQUUsRUFGTDtBQUdILElBQUEsWUFBWSxFQUFFLEVBSFg7QUFJSCxJQUFBLGdCQUFnQixFQUFFO0FBSmYsR0FWZTtBQWlCdEIsRUFBQSxVQWpCc0Isd0JBaUJUO0FBQ1QsSUFBQSxDQUFDLENBQUMsK0JBQUQsQ0FBRCxDQUFtQyxHQUFuQztBQUNBLElBQUEsQ0FBQyxDQUFDLGtDQUFELENBQUQsQ0FBc0MsUUFBdEM7QUFDQSxJQUFBLENBQUMsQ0FBQyw0QkFBRCxDQUFELENBQWdDLFFBQWhDLEdBSFMsQ0FLVDtBQUNBO0FBQ0E7O0FBQ0EsUUFBSSxDQUFDLE1BQU0sQ0FBQyxvQkFBUCxJQUErQixFQUFoQyxFQUFvQyxRQUF4QyxFQUFrRDtBQUM5QyxNQUFBLENBQUMsQ0FBQyx5Q0FDSSxnQ0FETCxDQUFELENBQ3dDLElBRHhDLENBQzZDLFVBRDdDLEVBQ3lELElBRHpEO0FBRUE7QUFDSDs7QUFFRCxJQUFBLENBQUMsQ0FBQyxxQkFBRCxDQUFELENBQXlCLEVBQXpCLENBQTRCLE9BQTVCLEVBQXFDLGlCQUFpQixDQUFDLGFBQXZEO0FBQ0EsSUFBQSxDQUFDLENBQUMsZ0NBQUQsQ0FB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Z0IsQ0FBaEIsRUFBbUIsSUFBbkIsR0FBMEIsT0FBMUIsQ0FBa0MsSUFBbEMsRUFBd0MsUUFBeEMsQ0FBUDtBQUFBLEtBQWxCOztBQUNBLDREQUE4QyxHQUFHLENBQUMsRUFBbEQsa0RBQzBCLE9BRDFCLGlEQUV5QixPQUFPLENBQUMsUUFBRCxDQUZoQyxrREFHMEIsT0FBTyxDQUFDLE9BQUQsQ0FIakMsa0NBSVUsQ0FBQyxDQUFDLE9BQUQsQ0FBRCxDQUFXLElBQVgsQ0FBZ0IsT0FBaEIsRUFBeUIsSUFBekIsRUFKViw0RkFLNkQsT0FBTyxDQUFDLE9BQUQsQ0FMcEUsMkVBTWlELENBQUMsQ0FBQyxPQUFELENBQUQsQ0FBVyxJQUFYLENBQWdCLFNBQWhCLEVBQTJCLElBQTNCLEVBTmpELGtEQVFVLENBQUMsQ0FBQyxPQUFELENBQUQsQ0FBVyxJQUFYLENBQWdCLE9BQWhCLEVBQXlCLElBQXpCLEVBUlYscWNBZ0J3RSxHQUFHLENBQUMsRUFoQjVFLDJCQWdCNkYsT0FoQjdGLCtmQXlCNEYsS0F6QjVGLHVCQXlCOEcsUUF6QjlHLHFZQWtDc0MsR0FBRyxDQUFDLEVBbEMxQyxtSUFvQytCLE9BQU8sQ0FBQyxlQUFlLENBQUMsa0NBQWpCLENBcEN0QztBQTBDSDtBQXRjcUIsQ0FBMUI7QUF5Y0EsQ0FBQyxDQUFDLFFBQUQsQ0FBRCxDQUFZLEtBQVosQ0FBa0IsWUFBTTtBQUNwQixFQUFBLGlCQUFpQixDQUFDLFVBQWxCO0FBQ0gsQ0FGRCIsImZpbGUiOiJtb2R1bGUtcGhyYXNlLXN0dWRpby1pbmRleC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qIGdsb2JhbCAkLCBnbG9iYWxSb290VXJsLCBnbG9iYWxUcmFuc2xhdGUsIFBieEFwaSwgVXNlck1lc3NhZ2UsIEluZGV4U291bmRQbGF5ZXIsIFRva2VuTWFuYWdlciwgU2VtYW50aWNMb2NhbGl6YXRpb24gKi9cblxuLyoqXG4gKiBTdHVkaW8gcGFnZSBjb250cm9sbGVyIGZvciBNb2R1bGVQaHJhc2VTdHVkaW8uXG4gKlxuICogVGhlIHBhZ2UgaGFzIGZvdXIgdGFicyAoc3R1ZGlvIC8gdm9pY2VzIC8gZW5naW5lIC8gaGlzdG9yeSkuIEFsbCBkYXRhIGZsb3dzXG4gKiB0aHJvdWdoIHRoZSBtb2R1bGUncyBSRVNUIHYzIGVuZHBvaW50cyB1bmRlciAvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8uXG4gKiBXZSByZWx5IG9uIFBieEFwaS5jYWxsSnNvblJlc3QgaGVscGVyLCB3aGljaCBhbHJlYWR5IGhhbmRsZXMgYXV0aCBoZWFkZXJzLlxuICovXG5jb25zdCBwaHJhc2VTdHVkaW9JbmRleCA9IHtcbiAgICBhcGk6IHtcbiAgICAgICAgZW5naW5lOiAgICAgICAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby9lbmdpbmUnLFxuICAgICAgICBlbmdpbmVJbnN0YWxsOiAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL2VuZ2luZTppbnN0YWxsJyxcbiAgICAgICAgdm9pY2VzOiAgICAgICAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby92b2ljZXMnLFxuICAgICAgICB2b2ljZUluc3RhbGw6ICAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL3ZvaWNlczppbnN0YWxsJyxcbiAgICAgICAgcGhyYXNlczogICAgICAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby9waHJhc2VzJyxcbiAgICAgICAgc2F2ZURlZmF1bHRzOiAgZ2xvYmFsUm9vdFVybCArICdtb2R1bGUtcGhyYXNlLXN0dWRpby9tb2R1bGUtcGhyYXNlLXN0dWRpby9zYXZlJyxcbiAgICB9LFxuXG4gICAgc3RhdGU6IHtcbiAgICAgICAgZW5naW5lOiBudWxsLFxuICAgICAgICB2b2ljZXM6IFtdLFxuICAgICAgICBzb3VuZFBsYXllcnM6IHt9LFxuICAgICAgICBoaXN0b3J5RGF0YVRhYmxlOiBudWxsLFxuICAgIH0sXG5cbiAgICBpbml0aWFsaXplKCkge1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10YWItbWVudSAuaXRlbScpLnRhYigpO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1yZW1lbWJlci1jaGVja2JveCcpLmNoZWNrYm94KCk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXNhbXBsZS1yYXRlJykuZHJvcGRvd24oKTtcblxuICAgICAgICAvLyBNb2R1bGUgZGlzYWJsZWQg4oaSIHBhZ2UgaXMgcmVhZC1vbmx5LCBza2lwIFJFU1QgcG9sbGluZyBhbmRcbiAgICAgICAgLy8gZGlzYWJsZSB0aGUgZm9ybSBpbnB1dHMuIEF2b2lkcyB0aGUgXCJmYWlsZWQgdG8gbG9hZCB2b2ljZXNcIlxuICAgICAgICAvLyBlcnJvciBwb3B1cCB1c2VycyBnb3Qgd2hlbiBvcGVuaW5nIGEgZGlzYWJsZWQgbW9kdWxlJ3MgcGFnZS5cbiAgICAgICAgaWYgKCh3aW5kb3cucGhyYXNlU3R1ZGlvRGVmYXVsdHMgfHwge30pLmRpc2FibGVkKSB7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1nZW5lcmF0ZS1mb3JtIDppbnB1dCwnXG4gICAgICAgICAgICAgICAgKyAnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtYnV0dG9uJykucHJvcCgnZGlzYWJsZWQnLCB0cnVlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS5vbignaW5wdXQnLCBwaHJhc2VTdHVkaW9JbmRleC51cGRhdGVDb3VudGVyKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtYnV0dG9uJykub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25HZW5lcmF0ZSk7XG4gICAgICAgICQoJ1tkYXRhLXRhYj1cInZvaWNlc1wiXScpLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMpO1xuICAgICAgICAkKCdbZGF0YS10YWI9XCJlbmdpbmVcIl0nKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKTtcbiAgICAgICAgJCgnW2RhdGEtdGFiPVwiaGlzdG9yeVwiXScpLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hIaXN0b3J5KTtcblxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5hcHBseURlZmF1bHRzKCk7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hFbmdpbmUoKTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaFZvaWNlcygpO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoSGlzdG9yeSgpO1xuICAgIH0sXG5cbiAgICBhcHBseURlZmF1bHRzKCkge1xuICAgICAgICBjb25zdCBkID0gd2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzIHx8IHt9O1xuICAgICAgICBpZiAoZC5zYW1wbGVSYXRlKSB7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1zYW1wbGUtcmF0ZScpLmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCBkLnNhbXBsZVJhdGUpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZUNvdW50ZXIoKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gJCgnI3BocmFzZS1zdHVkaW8tdGV4dCcpLnZhbCgpIHx8ICcnO1xuICAgICAgICBjb25zdCBtYXggICA9IHBhcnNlSW50KCQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS5hdHRyKCdtYXhsZW5ndGgnKSB8fCAnODAwJywgMTApO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0LWNvdW50ZXInKS50ZXh0KGAke3ZhbHVlLmxlbmd0aH0gLyAke21heH1gKTtcbiAgICB9LFxuXG4gICAgcmVmcmVzaEVuZ2luZSgpIHtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLmVuZ2luZSxcbiAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuZW5naW5lID0gKHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGEpIHx8IG51bGw7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJFbmdpbmUoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yRW5naW5lU3RhdHVzKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckVuZ2luZSgpIHtcbiAgICAgICAgY29uc3QgJGJveCA9ICQoJyNwaHJhc2Utc3R1ZGlvLWVuZ2luZS1zdGF0dXMnKS5lbXB0eSgpO1xuICAgICAgICBjb25zdCBkYXRhID0gcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuZW5naW5lIHx8IHt9O1xuICAgICAgICBpZiAoZGF0YS5pbnN0YWxsZWQpIHtcbiAgICAgICAgICAgICRib3guYXBwZW5kKFxuICAgICAgICAgICAgICAgICQoJzxkaXY+JykuYWRkQ2xhc3MoJ3VpIHBvc2l0aXZlIG1lc3NhZ2UnKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCQoJzxkaXY+JykuYWRkQ2xhc3MoJ2hlYWRlcicpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZUluc3RhbGxlZCkpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJCgnPHA+JykudGV4dChgJHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lVmVyc2lvbn06ICR7ZGF0YS52ZXJzaW9uIHx8ICfigJQnfWApKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgJCgnPGJ1dHRvbj4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5hZGRDbGFzcygndWkgc21hbGwgcmVkIGJhc2ljIGJ1dHRvbicpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZVVuaW5zdGFsbClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25FbmdpbmVVbmluc3RhbGwpXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAkYm94LmFwcGVuZChcbiAgICAgICAgICAgICAgICAkKCc8ZGl2PicpLmFkZENsYXNzKCd1aSB3YXJuaW5nIG1lc3NhZ2UnKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCQoJzxkaXY+JykuYWRkQ2xhc3MoJ2hlYWRlcicpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZU5vdEluc3RhbGxlZCkpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJCgnPHA+JykudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lSW5zdGFsbEhpbnQpKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgJCgnPGJ1dHRvbj4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5hZGRDbGFzcygndWkgcHJpbWFyeSBidXR0b24nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVJbnN0YWxsKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5vbkVuZ2luZUluc3RhbGwpXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgb25FbmdpbmVJbnN0YWxsKCkge1xuICAgICAgICBjb25zdCAkYnRuID0gJCh0aGlzKTtcbiAgICAgICAgJGJ0bi5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkuZW5naW5lSW5zdGFsbCxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hFbmdpbmUoKTtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5yZXN1bHQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKHJlc3BvbnNlLm1lc3NhZ2VzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yRW5naW5lSW5zdGFsbCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBvbkVuZ2luZVVuaW5zdGFsbCgpIHtcbiAgICAgICAgY29uc3QgJGJ0biA9ICQodGhpcyk7XG4gICAgICAgICRidG4uYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLmVuZ2luZSxcbiAgICAgICAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKCgpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hFbmdpbmUoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yRW5naW5lVW5pbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlZnJlc2hWb2ljZXMoKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS52b2ljZXMsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnZvaWNlcyA9IChyZXNwb25zZSAmJiByZXNwb25zZS5kYXRhKSB8fCBbXTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlbmRlclZvaWNlc1RhYmxlKCk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJWb2ljZVBpY2tlcigpO1xuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZXNMaXN0KTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlclZvaWNlc1RhYmxlKCkge1xuICAgICAgICBjb25zdCAkdGJvZHkgPSAkKCcjcGhyYXNlLXN0dWRpby12b2ljZXMtdGFibGUgdGJvZHknKS5lbXB0eSgpO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS52b2ljZXMuZm9yRWFjaCgodm9pY2UpID0+IHtcbiAgICAgICAgICAgIGNvbnN0ICRyb3cgPSAkKCc8dHI+Jyk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykudGV4dChgJHt2b2ljZS5sYW5ndWFnZV9sYWJlbH0gKCR7dm9pY2UubGFuZ3VhZ2V9KWApKTtcbiAgICAgICAgICAgICRyb3cuYXBwZW5kKCQoJzx0ZD4nKS50ZXh0KHZvaWNlLnZvaWNlX25hbWUpKTtcbiAgICAgICAgICAgICRyb3cuYXBwZW5kKCQoJzx0ZD4nKS50ZXh0KHZvaWNlLnF1YWxpdHkpKTtcbiAgICAgICAgICAgICRyb3cuYXBwZW5kKCQoJzx0ZD4nKS50ZXh0KGAke3ZvaWNlLnNhbXBsZV9yYXRlfSBIemApKTtcbiAgICAgICAgICAgICRyb3cuYXBwZW5kKCQoJzx0ZD4nKS5odG1sKHZvaWNlLmluc3RhbGxlZFxuICAgICAgICAgICAgICAgID8gYDxzcGFuIGNsYXNzPVwidWkgZ3JlZW4gbGFiZWxcIj4ke2dsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZUluc3RhbGxlZH08L3NwYW4+YFxuICAgICAgICAgICAgICAgIDogYDxzcGFuIGNsYXNzPVwidWkgbGFiZWxcIj4ke2dsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZU5vdEluc3RhbGxlZH08L3NwYW4+YCkpO1xuICAgICAgICAgICAgY29uc3QgJGFjdGlvbnMgPSAkKCc8dGQ+JykuYWRkQ2xhc3MoJ3JpZ2h0IGFsaWduZWQnKTtcbiAgICAgICAgICAgIGlmICh2b2ljZS5pbnN0YWxsZWQpIHtcbiAgICAgICAgICAgICAgICAkYWN0aW9ucy5hcHBlbmQoXG4gICAgICAgICAgICAgICAgICAgICQoJzxidXR0b24+JykuYWRkQ2xhc3MoJ3VpIHNtYWxsIGJhc2ljIHJlZCBpY29uIGJ1dHRvbicpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cignZGF0YS12b2ljZScsIHZvaWNlLnZvaWNlX2lkKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ3RpdGxlJywgZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlRGVsZXRlKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgnPGkgY2xhc3M9XCJ0cmFzaCBpY29uXCI+PC9pPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25Wb2ljZVVuaW5zdGFsbClcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAkYWN0aW9ucy5hcHBlbmQoXG4gICAgICAgICAgICAgICAgICAgICQoJzxidXR0b24+JykuYWRkQ2xhc3MoJ3VpIHNtYWxsIHByaW1hcnkgaWNvbiBidXR0b24nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ2RhdGEtdm9pY2UnLCB2b2ljZS52b2ljZV9pZClcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCd0aXRsZScsIGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZUluc3RhbGwpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCc8aSBjbGFzcz1cImRvd25sb2FkIGljb25cIj48L2k+JylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5vblZvaWNlSW5zdGFsbClcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJGFjdGlvbnMpO1xuICAgICAgICAgICAgJHRib2R5LmFwcGVuZCgkcm93KTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlclZvaWNlUGlja2VyKCkge1xuICAgICAgICBjb25zdCAkc2VsZWN0ID0gJCgnI3BocmFzZS1zdHVkaW8tdm9pY2UnKTtcbiAgICAgICAgY29uc3QgcHJldmlvdXMgPSAkc2VsZWN0LnZhbCgpO1xuICAgICAgICBjb25zdCBmYWxsYmFjayA9ICh3aW5kb3cucGhyYXNlU3R1ZGlvRGVmYXVsdHMgfHwge30pLnZvaWNlIHx8ICcnO1xuICAgICAgICAkc2VsZWN0LmVtcHR5KCk7XG4gICAgICAgIGNvbnN0IGluc3RhbGxlZCA9IHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnZvaWNlcy5maWx0ZXIoKHYpID0+IHYuaW5zdGFsbGVkKTtcbiAgICAgICAgaWYgKGluc3RhbGxlZC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICRzZWxlY3QuYXBwZW5kKCQoJzxvcHRpb24+JykudmFsKCcnKS50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19QaWNrZXJFbXB0eSkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaW5zdGFsbGVkLmZvckVhY2goKHZvaWNlKSA9PiB7XG4gICAgICAgICAgICAgICAgJHNlbGVjdC5hcHBlbmQoXG4gICAgICAgICAgICAgICAgICAgICQoJzxvcHRpb24+JylcbiAgICAgICAgICAgICAgICAgICAgICAgIC52YWwodm9pY2Uudm9pY2VfaWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAudGV4dChgJHt2b2ljZS5sYW5ndWFnZV9sYWJlbH0g4oCUICR7dm9pY2Uudm9pY2VfbmFtZX0gKCR7dm9pY2UucXVhbGl0eX0pYClcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgJHNlbGVjdC5kcm9wZG93bih7ZnVsbFRleHRTZWFyY2g6IHRydWV9KTtcbiAgICAgICAgY29uc3Qgd2FudCA9IHByZXZpb3VzIHx8IGZhbGxiYWNrO1xuICAgICAgICBpZiAod2FudCkge1xuICAgICAgICAgICAgJHNlbGVjdC5kcm9wZG93bignc2V0IHNlbGVjdGVkJywgd2FudCk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgb25Wb2ljZUluc3RhbGwoKSB7XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKHRoaXMpO1xuICAgICAgICBjb25zdCB2b2ljZUlkID0gJGJ0bi5kYXRhKCd2b2ljZScpO1xuICAgICAgICAkYnRuLmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS52b2ljZUluc3RhbGwsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KHt2b2ljZV9pZDogdm9pY2VJZH0pLFxuICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcocmVzcG9uc2UubWVzc2FnZXNcbiAgICAgICAgICAgICAgICAgICAgfHwgZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VJbnN0YWxsKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93SW5mb3JtYXRpb24oYCR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbGVkX1RvYXN0fTogJHt2b2ljZUlkfWApO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaFZvaWNlcygpO1xuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZUluc3RhbGwpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgb25Wb2ljZVVuaW5zdGFsbCgpIHtcbiAgICAgICAgY29uc3QgJGJ0biA9ICQodGhpcyk7XG4gICAgICAgIGNvbnN0IHZvaWNlSWQgPSAkYnRuLmRhdGEoJ3ZvaWNlJyk7XG4gICAgICAgICRidG4uYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogYCR7cGhyYXNlU3R1ZGlvSW5kZXguYXBpLnZvaWNlc30vJHtlbmNvZGVVUklDb21wb25lbnQodm9pY2VJZCl9YCxcbiAgICAgICAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKCgpID0+IHtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dJbmZvcm1hdGlvbihgJHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VVbmluc3RhbGxlZF9Ub2FzdH06ICR7dm9pY2VJZH1gKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VVbmluc3RhbGwpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgb25HZW5lcmF0ZSgpIHtcbiAgICAgICAgY29uc3QgdGV4dCAgICAgICA9ICgkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgY29uc3Qgdm9pY2VJZCAgICA9ICQoJyNwaHJhc2Utc3R1ZGlvLXZvaWNlJykudmFsKCkgfHwgJyc7XG4gICAgICAgIGNvbnN0IHNhbXBsZVJhdGUgPSAkKCcjcGhyYXNlLXN0dWRpby1zYW1wbGUtcmF0ZScpLnZhbCgpIHx8ICduYXRpdmUnO1xuICAgICAgICBpZiAoIXRleHQgfHwgIXZvaWNlSWQpIHtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVmFsaWRhdGlvbk1pc3NpbmcpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKCcjcGhyYXNlLXN0dWRpby1nZW5lcmF0ZS1idXR0b24nKS5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlcyxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoe3RleHQsIHZvaWNlX2lkOiB2b2ljZUlkLCBzYW1wbGVfcmF0ZTogc2FtcGxlUmF0ZX0pLFxuICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0gcmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YTtcbiAgICAgICAgICAgIGlmICghZGF0YSB8fCAhZGF0YS5waHJhc2VfaWQpIHtcbiAgICAgICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcocmVzcG9uc2UgJiYgcmVzcG9uc2UubWVzc2FnZXNcbiAgICAgICAgICAgICAgICAgICAgPyByZXNwb25zZS5tZXNzYWdlc1xuICAgICAgICAgICAgICAgICAgICA6IGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckdlbmVyYXRlKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoJCgnI3BocmFzZS1zdHVkaW8tcmVtZW1iZXInKS5pcygnOmNoZWNrZWQnKSkge1xuICAgICAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnBlcnNpc3REZWZhdWx0cyh2b2ljZUlkLCBzYW1wbGVSYXRlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIEhpc3RvcnkgdGFibGUgbGl2ZXMgcmlnaHQgdW5kZXIgdGhlIGZvcm0gb24gdGhlIFN0dWRpbyB0YWIsXG4gICAgICAgICAgICAvLyBzbyBhIHJlZnJlc2ggaXMgZW5vdWdoIOKAlCBubyB0YWIgc3dpdGNoLlxuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yR2VuZXJhdGUpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcGVyc2lzdERlZmF1bHRzKHZvaWNlSWQsIHNhbXBsZVJhdGUpIHtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLnNhdmVEZWZhdWx0cyxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YToge2RlZmF1bHRfdm9pY2U6IHZvaWNlSWQsIGRlZmF1bHRfc2FtcGxlX3JhdGU6IHNhbXBsZVJhdGV9LFxuICAgICAgICB9KS5kb25lKCgpID0+IHtcbiAgICAgICAgICAgIHdpbmRvdy5waHJhc2VTdHVkaW9EZWZhdWx0cyA9IHt2b2ljZTogdm9pY2VJZCwgc2FtcGxlUmF0ZX07XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZWZyZXNoSGlzdG9yeShjYWxsYmFjaykge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlcyxcbiAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVySGlzdG9yeSgocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSkgfHwgW10pO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZW5kZXJIaXN0b3J5KHJvd3MpIHtcbiAgICAgICAgLy8gVGVhciBkb3duIERhdGFUYWJsZSArIHNvdW5kIHBsYXllcnMgZnJvbSB0aGUgcHJldmlvdXMgcmVuZGVyLlxuICAgICAgICBpZiAocGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaGlzdG9yeURhdGFUYWJsZVxuICAgICAgICAgICAgJiYgJC5mbi5EYXRhVGFibGUuaXNEYXRhVGFibGUoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKSkge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaGlzdG9yeURhdGFUYWJsZS5kZXN0cm95KCk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBPYmplY3QudmFsdWVzKHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnNvdW5kUGxheWVycykuZm9yRWFjaCgocCkgPT4ge1xuICAgICAgICAgICAgaWYgKHAgJiYgcC5odG1sNUF1ZGlvKSB7XG4gICAgICAgICAgICAgICAgcC5odG1sNUF1ZGlvLnBhdXNlKCk7XG4gICAgICAgICAgICAgICAgcC5odG1sNUF1ZGlvLnNyYyA9ICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuc291bmRQbGF5ZXJzID0ge307XG5cbiAgICAgICAgY29uc3QgJHRib2R5ID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZSB0Ym9keScpLmVtcHR5KCk7XG4gICAgICAgIHJvd3MuZm9yRWFjaCgocm93KSA9PiB7XG4gICAgICAgICAgICAkdGJvZHkuYXBwZW5kKHBocmFzZVN0dWRpb0luZGV4LnJlbmRlckhpc3RvcnlSb3cocm93KSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0ICR0YWJsZVdyYXAgPSAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJykuY2xvc2VzdCgnLmRhdGFUYWJsZXNfd3JhcHBlcicpO1xuICAgICAgICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5oaWRlKCk7XG4gICAgICAgICAgICAoJHRhYmxlV3JhcC5sZW5ndGggPyAkdGFibGVXcmFwIDogJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpKS5oaWRlKCk7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LWVtcHR5Jykuc2hvdygpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktZW1wdHknKS5oaWRlKCk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5zaG93KCk7XG4gICAgICAgIGlmICgkdGFibGVXcmFwLmxlbmd0aCkge1xuICAgICAgICAgICAgJHRhYmxlV3JhcC5zaG93KCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJbml0aWFsaXNlIERhdGFUYWJsZSArIHNvdW5kIHBsYXllcnMsIG1pcnJvcmluZyBTb3VuZEZpbGVzIGluZGV4LlxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpLkRhdGFUYWJsZSh7XG4gICAgICAgICAgICBsZW5ndGhDaGFuZ2U6IGZhbHNlLFxuICAgICAgICAgICAgcGFnaW5nOiB0cnVlLFxuICAgICAgICAgICAgcGFnZUxlbmd0aDogMjUsXG4gICAgICAgICAgICBzZWFyY2hpbmc6IHRydWUsXG4gICAgICAgICAgICBpbmZvOiBmYWxzZSxcbiAgICAgICAgICAgIG9yZGVyaW5nOiB0cnVlLFxuICAgICAgICAgICAgbGFuZ3VhZ2U6IHR5cGVvZiBTZW1hbnRpY0xvY2FsaXphdGlvbiAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgICAgICAgICA/IFNlbWFudGljTG9jYWxpemF0aW9uLmRhdGFUYWJsZUxvY2FsaXNhdGlvblxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgb3JkZXI6IFtbMCwgJ2Rlc2MnXV0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJvd3MuZm9yRWFjaCgocm93KSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5zb3VuZFBsYXllcnNbcm93LmlkXSA9XG4gICAgICAgICAgICAgICAgbmV3IEluZGV4U291bmRQbGF5ZXIoYHBocmFzZS1yb3ctJHtyb3cuaWR9YCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFN0YW5kYXJkIE1pa29QQlggdHdvLXN0ZXAgZGVsZXRlIChkZWxldGUtc29tZXRoaW5nLmpzKSBmbGlwcyB0aGVcbiAgICAgICAgLy8gJ3R3by1zdGVwcy1kZWxldGUnIGNsYXNzIG9mZiBvbiB0aGUgZmlyc3QgY2xpY2suIFdlIGxpc3RlbiBmb3IgdGhlXG4gICAgICAgIC8vICpzZWNvbmQqIGNsaWNrICh3aGVuIHRoZSBjbGFzcyBpcyBnb25lKSB0byBmaXJlIHRoZSBSRVNUIERFTEVURS5cbiAgICAgICAgJCgnYm9keScpLm9mZignY2xpY2sucGhyYXNlU3R1ZGlvJyk7XG4gICAgICAgICQoJ2JvZHknKS5vbignY2xpY2sucGhyYXNlU3R1ZGlvJywgJ2EuZGVsZXRlOm5vdCgudHdvLXN0ZXBzLWRlbGV0ZSknLCBmdW5jdGlvbiBvbkNvbmZpcm1lZERlbGV0ZShlKSB7XG4gICAgICAgICAgICBjb25zdCAkdGFyZ2V0ID0gJChlLnRhcmdldCkuY2xvc2VzdCgnYS5kZWxldGUnKTtcbiAgICAgICAgICAgIGlmICgkdGFyZ2V0LmNsb3Nlc3QoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBlLnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgY29uc3QgaWQgPSAkdGFyZ2V0LmF0dHIoJ2RhdGEtdmFsdWUnKTtcbiAgICAgICAgICAgIGlmICghaWQpIHJldHVybjtcbiAgICAgICAgICAgICR0YXJnZXQuYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICAgICAgdXJsOiBgJHtwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlc30vJHtpZH1gLFxuICAgICAgICAgICAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgIH0pLmRvbmUoKCkgPT4gcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKSlcbiAgICAgICAgICAgICAgLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgJHRhcmdldC5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckhpc3RvcnlEZWxldGUpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0ICR0YmwgPSAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJyk7XG4gICAgICAgICR0YmwuZmluZCgnLnBvcHVwZWQnKS5wb3B1cCgpO1xuICAgICAgICAvLyBDbGljayBvbiB0aGUgdGV4dCBjZWxsIOKGkiBjb3B5IHBocmFzZSB0ZXh0ICsgdm9pY2UgYmFjayBpbnRvIHRoZSBmb3JtXG4gICAgICAgIC8vIHNvIHRoZSB1c2VyIGNhbiBlZGl0IGFuZCByZS1nZW5lcmF0ZSB3aXRob3V0IHJldHlwaW5nLiBLZWVwcyB0aGVcbiAgICAgICAgLy8gcGxheWVyIC8gZG93bmxvYWQgLyBkZWxldGUgYnV0dG9ucyBjbGlja2FibGUgb24gdGhlaXIgb3duLlxuICAgICAgICAkdGJsLm9mZignY2xpY2sucGhyYXNlU3R1ZGlvJyk7XG4gICAgICAgICR0Ymwub24oJ2NsaWNrLnBocmFzZVN0dWRpbycsICd0ZC5waHJhc2UtcmV1c2UnLCBmdW5jdGlvbiBvblJldXNlKCkge1xuICAgICAgICAgICAgY29uc3QgJHJvdyA9ICQodGhpcykuY2xvc2VzdCgndHInKTtcbiAgICAgICAgICAgIGNvbnN0IHRleHQgPSAkcm93LmF0dHIoJ2RhdGEtdGV4dCcpIHx8ICcnO1xuICAgICAgICAgICAgY29uc3Qgdm9pY2UgPSAkcm93LmF0dHIoJ2RhdGEtdm9pY2UnKSB8fCAnJztcbiAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS52YWwodGV4dCkudHJpZ2dlcignaW5wdXQnKTtcbiAgICAgICAgICAgIGlmICh2b2ljZSkge1xuICAgICAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXZvaWNlJykuZHJvcGRvd24oJ3NldCBzZWxlY3RlZCcsIHZvaWNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICQoJ2h0bWwsIGJvZHknKS5hbmltYXRlKHtzY3JvbGxUb3A6ICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS5vZmZzZXQoKS50b3AgLSA4MH0sIDIwMCk7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykuZm9jdXMoKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckhpc3RvcnlSb3cocm93KSB7XG4gICAgICAgIGNvbnN0IGNyZWF0ZWQgICA9IHJvdy5jcmVhdGVkX2F0ID8gbmV3IERhdGUocm93LmNyZWF0ZWRfYXQgKiAxMDAwKS50b0xvY2FsZVN0cmluZygpIDogJ+KAlCc7XG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ICA9IHJvdy50ZXh0IHx8ICcnO1xuICAgICAgICBjb25zdCBzaG9ydFRleHQgPSBmdWxsVGV4dC5sZW5ndGggPiA4MCA/IGAke2Z1bGxUZXh0LnN1YnN0cmluZygwLCA4MCl94oCmYCA6IGZ1bGxUZXh0O1xuICAgICAgICBjb25zdCB2b2ljZUlkICAgPSByb3cudm9pY2VfaWQgfHwgJyc7XG4gICAgICAgIGNvbnN0IHBsYXlVcmwgICA9IGAke3BocmFzZVN0dWRpb0luZGV4LmFwaS5waHJhc2VzfS8ke3Jvdy5pZH06ZG93bmxvYWRgO1xuICAgICAgICBjb25zdCBkbFVybCAgICAgPSBwbGF5VXJsO1xuICAgICAgICBjb25zdCBmaWxlbmFtZSAgPSBgcGhyYXNlXyR7cm93LmlkfS53YXZgO1xuICAgICAgICBjb25zdCB0b29sdGlwICAgPSBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fUm93UmV1c2VUb29sdGlwIHx8ICcnO1xuICAgICAgICBjb25zdCBlc2NBdHRyICAgPSAocykgPT4gJCgnPGRpdj4nKS50ZXh0KHMpLmh0bWwoKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7Jyk7XG4gICAgICAgIHJldHVybiBgPHRyIGNsYXNzPVwiZmlsZS1yb3dcIiBpZD1cInBocmFzZS1yb3ctJHtyb3cuaWR9XCJcbiAgICAgICAgICAgICAgICAgICAgZGF0YS12YWx1ZT1cIiR7cGxheVVybH1cIlxuICAgICAgICAgICAgICAgICAgICBkYXRhLXRleHQ9XCIke2VzY0F0dHIoZnVsbFRleHQpfVwiXG4gICAgICAgICAgICAgICAgICAgIGRhdGEtdm9pY2U9XCIke2VzY0F0dHIodm9pY2VJZCl9XCI+XG4gICAgICAgICAgICA8dGQ+JHskKCc8ZGl2PicpLnRleHQoY3JlYXRlZCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQgY2xhc3M9XCJwaHJhc2UtcmV1c2VcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyXCIgdGl0bGU9XCIke2VzY0F0dHIodG9vbHRpcCl9XCI+XG4gICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJmaWxlIGF1ZGlvIG91dGxpbmUgaWNvblwiPjwvaT4keyQoJzxkaXY+JykudGV4dChzaG9ydFRleHQpLmh0bWwoKX1cbiAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICA8dGQ+JHskKCc8ZGl2PicpLnRleHQodm9pY2VJZCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQgY2xhc3M9XCJzaXggd2lkZSBjZHItcGxheWVyIGhpZGUtb24tbW9iaWxlXCI+XG4gICAgICAgICAgICAgICAgPHRhYmxlPlxuICAgICAgICAgICAgICAgICAgICA8dHI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3M9XCJvbmUgd2lkZVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJ1aSB0aW55IGJhc2ljIGljb24gYnV0dG9uIHBsYXktYnV0dG9uXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpIGNsYXNzPVwidWkgaWNvbiBwbGF5XCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxhdWRpbyBwcmVsb2FkPVwibm9uZVwiIGlkPVwiYXVkaW8tcGxheWVyLXBocmFzZS1yb3ctJHtyb3cuaWR9XCIgZGF0YS1zcmM9XCIke3BsYXlVcmx9XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxzb3VyY2Ugc3JjPVwiXCIvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYXVkaW8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ1aSByYW5nZSBjZHItcGxheWVyXCI+PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj48c3BhbiBjbGFzcz1cImNkci1kdXJhdGlvblwiPjwvc3Bhbj48L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbiBkb3dubG9hZC1idXR0b25cIiBkYXRhLXZhbHVlPVwiJHtkbFVybH0/ZmlsZW5hbWU9JHtmaWxlbmFtZX1cIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJ1aSBpY29uIGRvd25sb2FkXCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgIDx0ZCBjbGFzcz1cImNvbGxhcHNpbmdcIj5cbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbnMgYWN0aW9uLWJ1dHRvbnNcIj5cbiAgICAgICAgICAgICAgICAgICAgPGEgaHJlZj1cIiNcIiBkYXRhLXZhbHVlPVwiJHtyb3cuaWR9XCJcbiAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ1aSBidXR0b24gZGVsZXRlIHR3by1zdGVwcy1kZWxldGUgcG9wdXBlZFwiXG4gICAgICAgICAgICAgICAgICAgICAgIGRhdGEtY29udGVudD1cIiR7ZXNjQXR0cihnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fSGlzdG9yeURlbGV0ZSl9XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aSBjbGFzcz1cImljb24gdHJhc2ggcmVkXCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICA8L2E+XG4gICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICA8L3RkPlxuICAgICAgICA8L3RyPmA7XG4gICAgfSxcbn07XG5cbiQoZG9jdW1lbnQpLnJlYWR5KCgpID0+IHtcbiAgICBwaHJhc2VTdHVkaW9JbmRleC5pbml0aWFsaXplKCk7XG59KTtcbiJdfQ==