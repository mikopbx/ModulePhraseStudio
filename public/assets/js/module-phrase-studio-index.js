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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNyYy9tb2R1bGUtcGhyYXNlLXN0dWRpby1pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBTSxpQkFBaUIsR0FBRztBQUN0QixFQUFBLEdBQUcsRUFBRTtBQUNELElBQUEsTUFBTSxFQUFTLDZDQURkO0FBRUQsSUFBQSxhQUFhLEVBQUUscURBRmQ7QUFHRCxJQUFBLE1BQU0sRUFBUyw2Q0FIZDtBQUlELElBQUEsWUFBWSxFQUFHLHFEQUpkO0FBS0QsSUFBQSxPQUFPLEVBQVEsOENBTGQ7QUFNRCxJQUFBLFlBQVksRUFBRyxhQUFhLEdBQUc7QUFOOUIsR0FEaUI7QUFVdEIsRUFBQSxLQUFLLEVBQUU7QUFDSCxJQUFBLE1BQU0sRUFBRSxJQURMO0FBRUgsSUFBQSxNQUFNLEVBQUUsRUFGTDtBQUdILElBQUEsWUFBWSxFQUFFLEVBSFg7QUFJSCxJQUFBLGdCQUFnQixFQUFFO0FBSmYsR0FWZTtBQWlCdEIsRUFBQSxVQWpCc0Isd0JBaUJUO0FBQ1QsSUFBQSxDQUFDLENBQUMsK0JBQUQsQ0FBRCxDQUFtQyxHQUFuQztBQUNBLElBQUEsQ0FBQyxDQUFDLGtDQUFELENBQUQsQ0FBc0MsUUFBdEM7QUFDQSxJQUFBLENBQUMsQ0FBQyw0QkFBRCxDQUFELENBQWdDLFFBQWhDLEdBSFMsQ0FLVDtBQUNBO0FBQ0E7O0FBQ0EsUUFBSSxDQUFDLE1BQU0sQ0FBQyxvQkFBUCxJQUErQixFQUFoQyxFQUFvQyxRQUF4QyxFQUFrRDtBQUM5QyxNQUFBLENBQUMsQ0FBQyx5Q0FDSSxnQ0FETCxDQUFELENBQ3dDLElBRHhDLENBQzZDLFVBRDdDLEVBQ3lELElBRHpEO0FBRUE7QUFDSDs7QUFFRCxJQUFBLENBQUMsQ0FBQyxxQkFBRCxDQUFELENBQXlCLEVBQXpCLENBQTRCLE9BQTVCLEVBQXFDLGlCQUFpQixDQUFDLGFBQXZEO0FBQ0EsSUFBQSxDQUFDLENBQUMsZ0NBQUQsQ0FB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SUFBekIsRUFSVixxY0FnQndFLEdBQUcsQ0FBQyxFQWhCNUUsMkJBZ0I2RixPQWhCN0YsK2ZBeUI0RixLQXpCNUYsdUJBeUI4RyxRQXpCOUcscVlBa0NzQyxHQUFHLENBQUMsRUFsQzFDLG1JQW9DK0IsT0FBTyxDQUFDLGVBQWUsQ0FBQyxrQ0FBakIsQ0FwQ3RDO0FBMENIO0FBN2JxQixDQUExQjtBQWdjQSxDQUFDLENBQUMsUUFBRCxDQUFELENBQVksS0FBWixDQUFrQixZQUFNO0FBQ3BCLEVBQUEsaUJBQWlCLENBQUMsVUFBbEI7QUFDSCxDQUZEIiwiZmlsZSI6Im1vZHVsZS1waHJhc2Utc3R1ZGlvLWluZGV4LmpzIiwic291cmNlc0NvbnRlbnQiOlsiLyogZ2xvYmFsICQsIGdsb2JhbFJvb3RVcmwsIGdsb2JhbFRyYW5zbGF0ZSwgUGJ4QXBpLCBVc2VyTWVzc2FnZSwgSW5kZXhTb3VuZFBsYXllciwgVG9rZW5NYW5hZ2VyLCBTZW1hbnRpY0xvY2FsaXphdGlvbiAqL1xuXG4vKipcbiAqIFN0dWRpbyBwYWdlIGNvbnRyb2xsZXIgZm9yIE1vZHVsZVBocmFzZVN0dWRpby5cbiAqXG4gKiBUaGUgcGFnZSBoYXMgZm91ciB0YWJzIChzdHVkaW8gLyB2b2ljZXMgLyBlbmdpbmUgLyBoaXN0b3J5KS4gQWxsIGRhdGEgZmxvd3NcbiAqIHRocm91Z2ggdGhlIG1vZHVsZSdzIFJFU1QgdjMgZW5kcG9pbnRzIHVuZGVyIC9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby5cbiAqIFdlIHJlbHkgb24gUGJ4QXBpLmNhbGxKc29uUmVzdCBoZWxwZXIsIHdoaWNoIGFscmVhZHkgaGFuZGxlcyBhdXRoIGhlYWRlcnMuXG4gKi9cbmNvbnN0IHBocmFzZVN0dWRpb0luZGV4ID0ge1xuICAgIGFwaToge1xuICAgICAgICBlbmdpbmU6ICAgICAgICAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL2VuZ2luZScsXG4gICAgICAgIGVuZ2luZUluc3RhbGw6ICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vZW5naW5lOmluc3RhbGwnLFxuICAgICAgICB2b2ljZXM6ICAgICAgICAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL3ZvaWNlcycsXG4gICAgICAgIHZvaWNlSW5zdGFsbDogICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vdm9pY2VzOmluc3RhbGwnLFxuICAgICAgICBwaHJhc2VzOiAgICAgICAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL3BocmFzZXMnLFxuICAgICAgICBzYXZlRGVmYXVsdHM6ICBnbG9iYWxSb290VXJsICsgJ21vZHVsZS1waHJhc2Utc3R1ZGlvL21vZHVsZS1waHJhc2Utc3R1ZGlvL3NhdmUnLFxuICAgIH0sXG5cbiAgICBzdGF0ZToge1xuICAgICAgICBlbmdpbmU6IG51bGwsXG4gICAgICAgIHZvaWNlczogW10sXG4gICAgICAgIHNvdW5kUGxheWVyczoge30sXG4gICAgICAgIGhpc3RvcnlEYXRhVGFibGU6IG51bGwsXG4gICAgfSxcblxuICAgIGluaXRpYWxpemUoKSB7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRhYi1tZW51IC5pdGVtJykudGFiKCk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXJlbWVtYmVyLWNoZWNrYm94JykuY2hlY2tib3goKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tc2FtcGxlLXJhdGUnKS5kcm9wZG93bigpO1xuXG4gICAgICAgIC8vIE1vZHVsZSBkaXNhYmxlZCDihpIgcGFnZSBpcyByZWFkLW9ubHksIHNraXAgUkVTVCBwb2xsaW5nIGFuZFxuICAgICAgICAvLyBkaXNhYmxlIHRoZSBmb3JtIGlucHV0cy4gQXZvaWRzIHRoZSBcImZhaWxlZCB0byBsb2FkIHZvaWNlc1wiXG4gICAgICAgIC8vIGVycm9yIHBvcHVwIHVzZXJzIGdvdCB3aGVuIG9wZW5pbmcgYSBkaXNhYmxlZCBtb2R1bGUncyBwYWdlLlxuICAgICAgICBpZiAoKHdpbmRvdy5waHJhc2VTdHVkaW9EZWZhdWx0cyB8fCB7fSkuZGlzYWJsZWQpIHtcbiAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWdlbmVyYXRlLWZvcm0gOmlucHV0LCdcbiAgICAgICAgICAgICAgICArICcjcGhyYXNlLXN0dWRpby1nZW5lcmF0ZS1idXR0b24nKS5wcm9wKCdkaXNhYmxlZCcsIHRydWUpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tdGV4dCcpLm9uKCdpbnB1dCcsIHBocmFzZVN0dWRpb0luZGV4LnVwZGF0ZUNvdW50ZXIpO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1nZW5lcmF0ZS1idXR0b24nKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5vbkdlbmVyYXRlKTtcbiAgICAgICAgJCgnW2RhdGEtdGFiPVwidm9pY2VzXCJdJykub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaFZvaWNlcyk7XG4gICAgICAgICQoJ1tkYXRhLXRhYj1cImVuZ2luZVwiXScpLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hFbmdpbmUpO1xuICAgICAgICAkKCdbZGF0YS10YWI9XCJoaXN0b3J5XCJdJykub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkpO1xuXG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LmFwcGx5RGVmYXVsdHMoKTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEVuZ2luZSgpO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoVm9pY2VzKCk7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hIaXN0b3J5KCk7XG4gICAgfSxcblxuICAgIGFwcGx5RGVmYXVsdHMoKSB7XG4gICAgICAgIGNvbnN0IGQgPSB3aW5kb3cucGhyYXNlU3R1ZGlvRGVmYXVsdHMgfHwge307XG4gICAgICAgIGlmIChkLnNhbXBsZVJhdGUpIHtcbiAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXNhbXBsZS1yYXRlJykuZHJvcGRvd24oJ3NldCBzZWxlY3RlZCcsIGQuc2FtcGxlUmF0ZSk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlQ291bnRlcigpIHtcbiAgICAgICAgY29uc3QgdmFsdWUgPSAkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykudmFsKCkgfHwgJyc7XG4gICAgICAgIGNvbnN0IG1heCAgID0gcGFyc2VJbnQoJCgnI3BocmFzZS1zdHVkaW8tdGV4dCcpLmF0dHIoJ21heGxlbmd0aCcpIHx8ICc4MDAnLCAxMCk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQtY291bnRlcicpLnRleHQoYCR7dmFsdWUubGVuZ3RofSAvICR7bWF4fWApO1xuICAgIH0sXG5cbiAgICByZWZyZXNoRW5naW5lKCkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkuZW5naW5lLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5lbmdpbmUgPSAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSkgfHwgbnVsbDtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlbmRlckVuZ2luZSgpO1xuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JFbmdpbmVTdGF0dXMpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcmVuZGVyRW5naW5lKCkge1xuICAgICAgICBjb25zdCAkYm94ID0gJCgnI3BocmFzZS1zdHVkaW8tZW5naW5lLXN0YXR1cycpLmVtcHR5KCk7XG4gICAgICAgIGNvbnN0IGRhdGEgPSBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5lbmdpbmUgfHwge307XG4gICAgICAgIGlmIChkYXRhLmluc3RhbGxlZCkge1xuICAgICAgICAgICAgJGJveC5hcHBlbmQoXG4gICAgICAgICAgICAgICAgJCgnPGRpdj4nKS5hZGRDbGFzcygndWkgcG9zaXRpdmUgbWVzc2FnZScpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJCgnPGRpdj4nKS5hZGRDbGFzcygnaGVhZGVyJykudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lSW5zdGFsbGVkKSlcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgkKCc8cD4nKS50ZXh0KGAke2dsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVWZXJzaW9ufTogJHtkYXRhLnZlcnNpb24gfHwgJ+KAlCd9YCkpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLmFkZENsYXNzKCd1aSBzbWFsbCByZWQgYmFzaWMgYnV0dG9uJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lVW5pbnN0YWxsKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5vbkVuZ2luZVVuaW5zdGFsbClcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICRib3guYXBwZW5kKFxuICAgICAgICAgICAgICAgICQoJzxkaXY+JykuYWRkQ2xhc3MoJ3VpIHdhcm5pbmcgbWVzc2FnZScpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJCgnPGRpdj4nKS5hZGRDbGFzcygnaGVhZGVyJykudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lTm90SW5zdGFsbGVkKSlcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgkKCc8cD4nKS50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVJbnN0YWxsSGludCkpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLmFkZENsYXNzKCd1aSBwcmltYXJ5IGJ1dHRvbicpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZUluc3RhbGwpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uRW5naW5lSW5zdGFsbClcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBvbkVuZ2luZUluc3RhbGwoKSB7XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKHRoaXMpO1xuICAgICAgICAkYnRuLmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5lbmdpbmVJbnN0YWxsLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEVuZ2luZSgpO1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcocmVzcG9uc2UubWVzc2FnZXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JFbmdpbmVJbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIG9uRW5naW5lVW5pbnN0YWxsKCkge1xuICAgICAgICBjb25zdCAkYnRuID0gJCh0aGlzKTtcbiAgICAgICAgJGJ0bi5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkuZW5naW5lLFxuICAgICAgICAgICAgbWV0aG9kOiAnREVMRVRFJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEVuZ2luZSgpO1xuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JFbmdpbmVVbmluc3RhbGwpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcmVmcmVzaFZvaWNlcygpIHtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLnZvaWNlcyxcbiAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzID0gKHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGEpIHx8IFtdO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVyVm9pY2VzVGFibGUoKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlbmRlclZvaWNlUGlja2VyKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvclZvaWNlc0xpc3QpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcmVuZGVyVm9pY2VzVGFibGUoKSB7XG4gICAgICAgIGNvbnN0ICR0Ym9keSA9ICQoJyNwaHJhc2Utc3R1ZGlvLXZvaWNlcy10YWJsZSB0Ym9keScpLmVtcHR5KCk7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnZvaWNlcy5mb3JFYWNoKCh2b2ljZSkgPT4ge1xuICAgICAgICAgICAgY29uc3QgJHJvdyA9ICQoJzx0cj4nKTtcbiAgICAgICAgICAgICRyb3cuYXBwZW5kKCQoJzx0ZD4nKS50ZXh0KGAke3ZvaWNlLmxhbmd1YWdlX2xhYmVsfSAoJHt2b2ljZS5sYW5ndWFnZX0pYCkpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQodm9pY2Uudm9pY2VfbmFtZSkpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQodm9pY2UucXVhbGl0eSkpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQoYCR7dm9pY2Uuc2FtcGxlX3JhdGV9IEh6YCkpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLmh0bWwodm9pY2UuaW5zdGFsbGVkXG4gICAgICAgICAgICAgICAgPyBgPHNwYW4gY2xhc3M9XCJ1aSBncmVlbiBsYWJlbFwiPiR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbGVkfTwvc3Bhbj5gXG4gICAgICAgICAgICAgICAgOiBgPHNwYW4gY2xhc3M9XCJ1aSBsYWJlbFwiPiR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlTm90SW5zdGFsbGVkfTwvc3Bhbj5gKSk7XG4gICAgICAgICAgICBjb25zdCAkYWN0aW9ucyA9ICQoJzx0ZD4nKS5hZGRDbGFzcygncmlnaHQgYWxpZ25lZCcpO1xuICAgICAgICAgICAgaWYgKHZvaWNlLmluc3RhbGxlZCkge1xuICAgICAgICAgICAgICAgICRhY3Rpb25zLmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgJCgnPGJ1dHRvbj4nKS5hZGRDbGFzcygndWkgc21hbGwgYmFzaWMgcmVkIGljb24gYnV0dG9uJylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCdkYXRhLXZvaWNlJywgdm9pY2Uudm9pY2VfaWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cigndGl0bGUnLCBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VEZWxldGUpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCc8aSBjbGFzcz1cInRyYXNoIGljb25cIj48L2k+JylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5vblZvaWNlVW5pbnN0YWxsKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICRhY3Rpb25zLmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgJCgnPGJ1dHRvbj4nKS5hZGRDbGFzcygndWkgc21hbGwgcHJpbWFyeSBpY29uIGJ1dHRvbicpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cignZGF0YS12b2ljZScsIHZvaWNlLnZvaWNlX2lkKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ3RpdGxlJywgZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbClcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJzxpIGNsYXNzPVwiZG93bmxvYWQgaWNvblwiPjwvaT4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uVm9pY2VJbnN0YWxsKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkYWN0aW9ucyk7XG4gICAgICAgICAgICAkdGJvZHkuYXBwZW5kKCRyb3cpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcmVuZGVyVm9pY2VQaWNrZXIoKSB7XG4gICAgICAgIGNvbnN0ICRzZWxlY3QgPSAkKCcjcGhyYXNlLXN0dWRpby12b2ljZScpO1xuICAgICAgICBjb25zdCBwcmV2aW91cyA9ICRzZWxlY3QudmFsKCk7XG4gICAgICAgIGNvbnN0IGZhbGxiYWNrID0gKHdpbmRvdy5waHJhc2VTdHVkaW9EZWZhdWx0cyB8fCB7fSkudm9pY2UgfHwgJyc7XG4gICAgICAgICRzZWxlY3QuZW1wdHkoKTtcbiAgICAgICAgY29uc3QgaW5zdGFsbGVkID0gcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzLmZpbHRlcigodikgPT4gdi5pbnN0YWxsZWQpO1xuICAgICAgICBpZiAoaW5zdGFsbGVkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgJHNlbGVjdC5hcHBlbmQoJCgnPG9wdGlvbj4nKS52YWwoJycpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1BpY2tlckVtcHR5KSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpbnN0YWxsZWQuZm9yRWFjaCgodm9pY2UpID0+IHtcbiAgICAgICAgICAgICAgICAkc2VsZWN0LmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgJCgnPG9wdGlvbj4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLnZhbCh2b2ljZS52b2ljZV9pZClcbiAgICAgICAgICAgICAgICAgICAgICAgIC50ZXh0KGAke3ZvaWNlLmxhbmd1YWdlX2xhYmVsfSDigJQgJHt2b2ljZS52b2ljZV9uYW1lfSAoJHt2b2ljZS5xdWFsaXR5fSlgKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICAkc2VsZWN0LmRyb3Bkb3duKHtmdWxsVGV4dFNlYXJjaDogdHJ1ZX0pO1xuICAgICAgICBjb25zdCB3YW50ID0gcHJldmlvdXMgfHwgZmFsbGJhY2s7XG4gICAgICAgIGlmICh3YW50KSB7XG4gICAgICAgICAgICAkc2VsZWN0LmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCB3YW50KTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBvblZvaWNlSW5zdGFsbCgpIHtcbiAgICAgICAgY29uc3QgJGJ0biA9ICQodGhpcyk7XG4gICAgICAgIGNvbnN0IHZvaWNlSWQgPSAkYnRuLmRhdGEoJ3ZvaWNlJyk7XG4gICAgICAgICRidG4uYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLnZvaWNlSW5zdGFsbCxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoe3ZvaWNlX2lkOiB2b2ljZUlkfSksXG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5yZXN1bHQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhyZXNwb25zZS5tZXNzYWdlc1xuICAgICAgICAgICAgICAgICAgICB8fCBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZUluc3RhbGwpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dJbmZvcm1hdGlvbihgJHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VJbnN0YWxsZWRfVG9hc3R9OiAke3ZvaWNlSWR9YCk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoVm9pY2VzKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvclZvaWNlSW5zdGFsbCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBvblZvaWNlVW5pbnN0YWxsKCkge1xuICAgICAgICBjb25zdCAkYnRuID0gJCh0aGlzKTtcbiAgICAgICAgY29uc3Qgdm9pY2VJZCA9ICRidG4uZGF0YSgndm9pY2UnKTtcbiAgICAgICAgJGJ0bi5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBgJHtwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VzfS8ke2VuY29kZVVSSUNvbXBvbmVudCh2b2ljZUlkKX1gLFxuICAgICAgICAgICAgbWV0aG9kOiAnREVMRVRFJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKCkgPT4ge1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd0luZm9ybWF0aW9uKGAke2dsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZVVuaW5zdGFsbGVkX1RvYXN0fTogJHt2b2ljZUlkfWApO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaFZvaWNlcygpO1xuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZVVuaW5zdGFsbCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBvbkdlbmVyYXRlKCkge1xuICAgICAgICBjb25zdCB0ZXh0ICAgICAgID0gKCQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS52YWwoKSB8fCAnJykudHJpbSgpO1xuICAgICAgICBjb25zdCB2b2ljZUlkICAgID0gJCgnI3BocmFzZS1zdHVkaW8tdm9pY2UnKS52YWwoKSB8fCAnJztcbiAgICAgICAgY29uc3Qgc2FtcGxlUmF0ZSA9ICQoJyNwaHJhc2Utc3R1ZGlvLXNhbXBsZS1yYXRlJykudmFsKCkgfHwgJ25hdGl2ZSc7XG4gICAgICAgIGlmICghdGV4dCB8fCAhdm9pY2VJZCkge1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19WYWxpZGF0aW9uTWlzc2luZyk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgJGJ0biA9ICQoJyNwaHJhc2Utc3R1ZGlvLWdlbmVyYXRlLWJ1dHRvbicpLmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5waHJhc2VzLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBkYXRhOiBKU09OLnN0cmluZ2lmeSh7dGV4dCwgdm9pY2VfaWQ6IHZvaWNlSWQsIHNhbXBsZV9yYXRlOiBzYW1wbGVSYXRlfSksXG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIGNvbnN0IGRhdGEgPSByZXNwb25zZSAmJiByZXNwb25zZS5kYXRhO1xuICAgICAgICAgICAgaWYgKCFkYXRhIHx8ICFkYXRhLnBocmFzZV9pZCkge1xuICAgICAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhyZXNwb25zZSAmJiByZXNwb25zZS5tZXNzYWdlc1xuICAgICAgICAgICAgICAgICAgICA/IHJlc3BvbnNlLm1lc3NhZ2VzXG4gICAgICAgICAgICAgICAgICAgIDogZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yR2VuZXJhdGUpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICgkKCcjcGhyYXNlLXN0dWRpby1yZW1lbWJlcicpLmlzKCc6Y2hlY2tlZCcpKSB7XG4gICAgICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucGVyc2lzdERlZmF1bHRzKHZvaWNlSWQsIHNhbXBsZVJhdGUpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gSGlzdG9yeSB0YWJsZSBsaXZlcyByaWdodCB1bmRlciB0aGUgZm9ybSBvbiB0aGUgU3R1ZGlvIHRhYixcbiAgICAgICAgICAgIC8vIHNvIGEgcmVmcmVzaCBpcyBlbm91Z2gg4oCUIG5vIHRhYiBzd2l0Y2guXG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoSGlzdG9yeSgpO1xuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JHZW5lcmF0ZSk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBwZXJzaXN0RGVmYXVsdHModm9pY2VJZCwgc2FtcGxlUmF0ZSkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkuc2F2ZURlZmF1bHRzLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBkYXRhOiB7ZGVmYXVsdF92b2ljZTogdm9pY2VJZCwgZGVmYXVsdF9zYW1wbGVfcmF0ZTogc2FtcGxlUmF0ZX0sXG4gICAgICAgIH0pLmRvbmUoKCkgPT4ge1xuICAgICAgICAgICAgd2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzID0ge3ZvaWNlOiB2b2ljZUlkLCBzYW1wbGVSYXRlfTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlZnJlc2hIaXN0b3J5KGNhbGxiYWNrKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5waHJhc2VzLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJIaXN0b3J5KChyZXNwb25zZSAmJiByZXNwb25zZS5kYXRhKSB8fCBbXSk7XG4gICAgICAgICAgICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckhpc3Rvcnkocm93cykge1xuICAgICAgICAvLyBUZWFyIGRvd24gRGF0YVRhYmxlICsgc291bmQgcGxheWVycyBmcm9tIHRoZSBwcmV2aW91cyByZW5kZXIuXG4gICAgICAgIGlmIChwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlXG4gICAgICAgICAgICAmJiAkLmZuLkRhdGFUYWJsZS5pc0RhdGFUYWJsZSgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpKSB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlLmRlc3Ryb3koKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmhpc3RvcnlEYXRhVGFibGUgPSBudWxsO1xuICAgICAgICB9XG4gICAgICAgIE9iamVjdC52YWx1ZXMocGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuc291bmRQbGF5ZXJzKS5mb3JFYWNoKChwKSA9PiB7XG4gICAgICAgICAgICBpZiAocCAmJiBwLmh0bWw1QXVkaW8pIHtcbiAgICAgICAgICAgICAgICBwLmh0bWw1QXVkaW8ucGF1c2UoKTtcbiAgICAgICAgICAgICAgICBwLmh0bWw1QXVkaW8uc3JjID0gJyc7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5zb3VuZFBsYXllcnMgPSB7fTtcblxuICAgICAgICBjb25zdCAkdGJvZHkgPSAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlIHRib2R5JykuZW1wdHkoKTtcbiAgICAgICAgcm93cy5mb3JFYWNoKChyb3cpID0+IHtcbiAgICAgICAgICAgICR0Ym9keS5hcHBlbmQocGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVySGlzdG9yeVJvdyhyb3cpKTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJbml0aWFsaXNlIERhdGFUYWJsZSArIHNvdW5kIHBsYXllcnMsIG1pcnJvcmluZyBTb3VuZEZpbGVzIGluZGV4LlxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpLkRhdGFUYWJsZSh7XG4gICAgICAgICAgICBsZW5ndGhDaGFuZ2U6IGZhbHNlLFxuICAgICAgICAgICAgcGFnaW5nOiB0cnVlLFxuICAgICAgICAgICAgcGFnZUxlbmd0aDogMjUsXG4gICAgICAgICAgICBzZWFyY2hpbmc6IHRydWUsXG4gICAgICAgICAgICBpbmZvOiBmYWxzZSxcbiAgICAgICAgICAgIG9yZGVyaW5nOiB0cnVlLFxuICAgICAgICAgICAgbGFuZ3VhZ2U6IHR5cGVvZiBTZW1hbnRpY0xvY2FsaXphdGlvbiAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgICAgICAgICA/IFNlbWFudGljTG9jYWxpemF0aW9uLmRhdGFUYWJsZUxvY2FsaXNhdGlvblxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgb3JkZXI6IFtbMCwgJ2Rlc2MnXV0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJvd3MuZm9yRWFjaCgocm93KSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5zb3VuZFBsYXllcnNbcm93LmlkXSA9XG4gICAgICAgICAgICAgICAgbmV3IEluZGV4U291bmRQbGF5ZXIoYHBocmFzZS1yb3ctJHtyb3cuaWR9YCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFN0YW5kYXJkIE1pa29QQlggdHdvLXN0ZXAgZGVsZXRlIChkZWxldGUtc29tZXRoaW5nLmpzKSBmbGlwcyB0aGVcbiAgICAgICAgLy8gJ3R3by1zdGVwcy1kZWxldGUnIGNsYXNzIG9mZiBvbiB0aGUgZmlyc3QgY2xpY2suIFdlIGxpc3RlbiBmb3IgdGhlXG4gICAgICAgIC8vICpzZWNvbmQqIGNsaWNrICh3aGVuIHRoZSBjbGFzcyBpcyBnb25lKSB0byBmaXJlIHRoZSBSRVNUIERFTEVURS5cbiAgICAgICAgJCgnYm9keScpLm9mZignY2xpY2sucGhyYXNlU3R1ZGlvJyk7XG4gICAgICAgICQoJ2JvZHknKS5vbignY2xpY2sucGhyYXNlU3R1ZGlvJywgJ2EuZGVsZXRlOm5vdCgudHdvLXN0ZXBzLWRlbGV0ZSknLCBmdW5jdGlvbiBvbkNvbmZpcm1lZERlbGV0ZShlKSB7XG4gICAgICAgICAgICBjb25zdCAkdGFyZ2V0ID0gJChlLnRhcmdldCkuY2xvc2VzdCgnYS5kZWxldGUnKTtcbiAgICAgICAgICAgIGlmICgkdGFyZ2V0LmNsb3Nlc3QoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBlLnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgY29uc3QgaWQgPSAkdGFyZ2V0LmF0dHIoJ2RhdGEtdmFsdWUnKTtcbiAgICAgICAgICAgIGlmICghaWQpIHJldHVybjtcbiAgICAgICAgICAgICR0YXJnZXQuYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICAgICAgdXJsOiBgJHtwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlc30vJHtpZH1gLFxuICAgICAgICAgICAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgIH0pLmRvbmUoKCkgPT4gcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKSlcbiAgICAgICAgICAgICAgLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgJHRhcmdldC5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckhpc3RvcnlEZWxldGUpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0ICR0YmwgPSAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJyk7XG4gICAgICAgICR0YmwuZmluZCgnLnBvcHVwZWQnKS5wb3B1cCgpO1xuICAgICAgICAvLyBDbGljayBvbiB0aGUgdGV4dCBjZWxsIOKGkiBjb3B5IHBocmFzZSB0ZXh0ICsgdm9pY2UgYmFjayBpbnRvIHRoZSBmb3JtXG4gICAgICAgIC8vIHNvIHRoZSB1c2VyIGNhbiBlZGl0IGFuZCByZS1nZW5lcmF0ZSB3aXRob3V0IHJldHlwaW5nLiBLZWVwcyB0aGVcbiAgICAgICAgLy8gcGxheWVyIC8gZG93bmxvYWQgLyBkZWxldGUgYnV0dG9ucyBjbGlja2FibGUgb24gdGhlaXIgb3duLlxuICAgICAgICAkdGJsLm9mZignY2xpY2sucGhyYXNlU3R1ZGlvJyk7XG4gICAgICAgICR0Ymwub24oJ2NsaWNrLnBocmFzZVN0dWRpbycsICd0ZC5waHJhc2UtcmV1c2UnLCBmdW5jdGlvbiBvblJldXNlKCkge1xuICAgICAgICAgICAgY29uc3QgJHJvdyA9ICQodGhpcykuY2xvc2VzdCgndHInKTtcbiAgICAgICAgICAgIGNvbnN0IHRleHQgPSAkcm93LmF0dHIoJ2RhdGEtdGV4dCcpIHx8ICcnO1xuICAgICAgICAgICAgY29uc3Qgdm9pY2UgPSAkcm93LmF0dHIoJ2RhdGEtdm9pY2UnKSB8fCAnJztcbiAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS52YWwodGV4dCkudHJpZ2dlcignaW5wdXQnKTtcbiAgICAgICAgICAgIGlmICh2b2ljZSkge1xuICAgICAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXZvaWNlJykuZHJvcGRvd24oJ3NldCBzZWxlY3RlZCcsIHZvaWNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICQoJ2h0bWwsIGJvZHknKS5hbmltYXRlKHtzY3JvbGxUb3A6ICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS5vZmZzZXQoKS50b3AgLSA4MH0sIDIwMCk7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykuZm9jdXMoKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckhpc3RvcnlSb3cocm93KSB7XG4gICAgICAgIGNvbnN0IGNyZWF0ZWQgICA9IHJvdy5jcmVhdGVkX2F0ID8gbmV3IERhdGUocm93LmNyZWF0ZWRfYXQgKiAxMDAwKS50b0xvY2FsZVN0cmluZygpIDogJ+KAlCc7XG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ICA9IHJvdy50ZXh0IHx8ICcnO1xuICAgICAgICBjb25zdCBzaG9ydFRleHQgPSBmdWxsVGV4dC5sZW5ndGggPiA4MCA/IGAke2Z1bGxUZXh0LnN1YnN0cmluZygwLCA4MCl94oCmYCA6IGZ1bGxUZXh0O1xuICAgICAgICBjb25zdCB2b2ljZUlkICAgPSByb3cudm9pY2VfaWQgfHwgJyc7XG4gICAgICAgIGNvbnN0IHBsYXlVcmwgICA9IGAke3BocmFzZVN0dWRpb0luZGV4LmFwaS5waHJhc2VzfS8ke3Jvdy5pZH06ZG93bmxvYWRgO1xuICAgICAgICBjb25zdCBkbFVybCAgICAgPSBwbGF5VXJsO1xuICAgICAgICBjb25zdCBmaWxlbmFtZSAgPSBgcGhyYXNlXyR7cm93LmlkfS53YXZgO1xuICAgICAgICBjb25zdCB0b29sdGlwICAgPSBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fUm93UmV1c2VUb29sdGlwIHx8ICcnO1xuICAgICAgICBjb25zdCBlc2NBdHRyICAgPSAocykgPT4gJCgnPGRpdj4nKS50ZXh0KHMpLmh0bWwoKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7Jyk7XG4gICAgICAgIHJldHVybiBgPHRyIGNsYXNzPVwiZmlsZS1yb3dcIiBpZD1cInBocmFzZS1yb3ctJHtyb3cuaWR9XCJcbiAgICAgICAgICAgICAgICAgICAgZGF0YS12YWx1ZT1cIiR7cGxheVVybH1cIlxuICAgICAgICAgICAgICAgICAgICBkYXRhLXRleHQ9XCIke2VzY0F0dHIoZnVsbFRleHQpfVwiXG4gICAgICAgICAgICAgICAgICAgIGRhdGEtdm9pY2U9XCIke2VzY0F0dHIodm9pY2VJZCl9XCI+XG4gICAgICAgICAgICA8dGQ+JHskKCc8ZGl2PicpLnRleHQoY3JlYXRlZCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQgY2xhc3M9XCJwaHJhc2UtcmV1c2VcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyXCIgdGl0bGU9XCIke2VzY0F0dHIodG9vbHRpcCl9XCI+XG4gICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJmaWxlIGF1ZGlvIG91dGxpbmUgaWNvblwiPjwvaT4keyQoJzxkaXY+JykudGV4dChzaG9ydFRleHQpLmh0bWwoKX1cbiAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICA8dGQ+JHskKCc8ZGl2PicpLnRleHQodm9pY2VJZCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQgY2xhc3M9XCJzaXggd2lkZSBjZHItcGxheWVyIGhpZGUtb24tbW9iaWxlXCI+XG4gICAgICAgICAgICAgICAgPHRhYmxlPlxuICAgICAgICAgICAgICAgICAgICA8dHI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3M9XCJvbmUgd2lkZVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJ1aSB0aW55IGJhc2ljIGljb24gYnV0dG9uIHBsYXktYnV0dG9uXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpIGNsYXNzPVwidWkgaWNvbiBwbGF5XCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxhdWRpbyBwcmVsb2FkPVwibm9uZVwiIGlkPVwiYXVkaW8tcGxheWVyLXBocmFzZS1yb3ctJHtyb3cuaWR9XCIgZGF0YS1zcmM9XCIke3BsYXlVcmx9XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxzb3VyY2Ugc3JjPVwiXCIvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYXVkaW8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ1aSByYW5nZSBjZHItcGxheWVyXCI+PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj48c3BhbiBjbGFzcz1cImNkci1kdXJhdGlvblwiPjwvc3Bhbj48L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbiBkb3dubG9hZC1idXR0b25cIiBkYXRhLXZhbHVlPVwiJHtkbFVybH0/ZmlsZW5hbWU9JHtmaWxlbmFtZX1cIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJ1aSBpY29uIGRvd25sb2FkXCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgIDx0ZCBjbGFzcz1cImNvbGxhcHNpbmdcIj5cbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbnMgYWN0aW9uLWJ1dHRvbnNcIj5cbiAgICAgICAgICAgICAgICAgICAgPGEgaHJlZj1cIiNcIiBkYXRhLXZhbHVlPVwiJHtyb3cuaWR9XCJcbiAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ1aSBidXR0b24gZGVsZXRlIHR3by1zdGVwcy1kZWxldGUgcG9wdXBlZFwiXG4gICAgICAgICAgICAgICAgICAgICAgIGRhdGEtY29udGVudD1cIiR7ZXNjQXR0cihnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fSGlzdG9yeURlbGV0ZSl9XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aSBjbGFzcz1cImljb24gdHJhc2ggcmVkXCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICA8L2E+XG4gICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICA8L3RkPlxuICAgICAgICA8L3RyPmA7XG4gICAgfSxcbn07XG5cbiQoZG9jdW1lbnQpLnJlYWR5KCgpID0+IHtcbiAgICBwaHJhc2VTdHVkaW9JbmRleC5pbml0aWFsaXplKCk7XG59KTtcbiJdfQ==