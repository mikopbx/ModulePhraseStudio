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
    historyDataTable: null,
    // voice_id → { startedAt, attempts, timer } for installs in flight.
    // Tracking attempts client-side lets us cap polling at ~10 minutes
    // even if the worker silently dies, instead of spinning forever.
    installPolls: {}
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

  /**
   * Translates a Piper language tag (e.g. 'ru-ru', 'en-us', 'pt-br')
   * into a Semantic UI flag class. The second segment is already an
   * ISO 3166-1 alpha-2 country code in the catalogue, so we just
   * extract and lowercase it. Unknown tags fall back to no flag.
   */
  flagClassFor: function flagClassFor(language) {
    if (!language) return '';
    var parts = String(language).toLowerCase().split('-');
    var cc = parts[parts.length - 1];
    if (!cc || cc.length !== 2) return '';
    return cc;
  },
  renderVoicesTable: function renderVoicesTable() {
    var $tbody = $('#phrase-studio-voices-table tbody').empty();
    phraseStudioIndex.state.voices.forEach(function (voice) {
      var $row = $('<tr>').attr('data-voice', voice.voice_id);
      var flag = phraseStudioIndex.flagClassFor(voice.language);
      var $lang = $('<td>');

      if (flag) {
        $lang.append("<i class=\"".concat(flag, " flag\"></i>"));
      }

      $lang.append(document.createTextNode("".concat(voice.language_label, " (").concat(voice.language, ")")));
      $row.append($lang);
      $row.append($('<td>').text(voice.voice_name));
      $row.append($('<td>').text(voice.quality));
      $row.append($('<td>').text("".concat(voice.sample_rate, " Hz")));
      var status = voice.install_status || (voice.installed ? 'installed' : '');
      var $statusCell = $('<td>');

      if (status === 'installed') {
        $statusCell.html("<span class=\"ui green label\">".concat(globalTranslate.module_phrase_studio_VoiceInstalled, "</span>"));
      } else if (status === 'installing') {
        $statusCell.html('<div class="ui active inline mini loader"></div> ' + "<span class=\"ui yellow label\">".concat(globalTranslate.module_phrase_studio_VoiceInstalling, "</span>"));
      } else if (status === 'failed') {
        var err = voice.install_error || '';
        $statusCell.html("<span class=\"ui red label\" title=\"".concat($('<div>').text(err).html(), "\">") + "".concat(globalTranslate.module_phrase_studio_VoiceFailed, "</span>"));
      } else {
        $statusCell.html("<span class=\"ui label\">".concat(globalTranslate.module_phrase_studio_VoiceNotInstalled, "</span>"));
      }

      $row.append($statusCell);
      var $actions = $('<td>').addClass('right aligned');

      if (status === 'installed') {
        $actions.append($('<button>').addClass('ui small basic red icon button').attr('data-voice', voice.voice_id).attr('title', globalTranslate.module_phrase_studio_VoiceDelete).append('<i class="trash icon"></i>').on('click', phraseStudioIndex.onVoiceUninstall));
      } else if (status === 'installing') {
        // While the worker is downloading we lock the action cell —
        // showing a disabled spinner makes the in-flight state read
        // clearly and prevents double-publish on impatient clicks.
        $actions.append($('<button>').addClass('ui small primary icon button loading disabled').attr('data-voice', voice.voice_id).attr('title', globalTranslate.module_phrase_studio_VoiceInstalling).append('<i class="download icon"></i>'));
      } else {
        // 'failed' and not-installed share the same action button —
        // both result in publishing a fresh install_voice job.
        var label = status === 'failed' ? globalTranslate.module_phrase_studio_VoiceRetry : globalTranslate.module_phrase_studio_VoiceInstall;
        $actions.append($('<button>').addClass('ui small primary icon button').attr('data-voice', voice.voice_id).attr('title', label).append('<i class="download icon"></i>').on('click', phraseStudioIndex.onVoiceInstall));
      }

      $row.append($actions);
      $tbody.append($row);
    }); // Re-arm polling for any voice the server still reports as
    // 'installing' (covers page reloads mid-install).

    phraseStudioIndex.state.voices.filter(function (v) {
      return v.install_status === 'installing';
    }).forEach(function (v) {
      return phraseStudioIndex.scheduleInstallPoll(v.voice_id);
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
        var flag = phraseStudioIndex.flagClassFor(voice.language); // Semantic UI dropdown reads `data-text` for the display string
        // and renders a flag from `data-flag` when present, so the chosen
        // option keeps the icon after selection.

        var $opt = $('<option>').val(voice.voice_id).text("".concat(voice.language_label, " \u2014 ").concat(voice.voice_name, " (").concat(voice.quality, ")"));

        if (flag) {
          $opt.attr('data-flag', flag);
        }

        $select.append($opt);
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
    var voiceId = $btn.data('voice'); // Lock the button immediately so impatient double-clicks can't queue
    // a duplicate install. The button stays disabled until refreshVoices
    // re-renders the row from the new install_status.

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
      } // Backend returns 202 with install_status='installing' before the
      // worker actually runs curl. The row spinner + "Downloading…" label
      // and the disabled action button already convey the in-flight state
      // — no toast needed.


      phraseStudioIndex.refreshVoices();
      phraseStudioIndex.scheduleInstallPoll(voiceId);
    }).fail(function () {
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
  scheduleInstallPoll: function scheduleInstallPoll(voiceId) {
    var polls = phraseStudioIndex.state.installPolls;
    if (polls[voiceId]) return;
    polls[voiceId] = {
      startedAt: Date.now(),
      attempts: 0
    };
    polls[voiceId].timer = setInterval(function () {
      return phraseStudioIndex.tickInstallPoll(voiceId);
    }, phraseStudioIndex.INSTALL_POLL_INTERVAL_MS);
  },
  cancelInstallPoll: function cancelInstallPoll(voiceId) {
    var entry = phraseStudioIndex.state.installPolls[voiceId];
    if (!entry) return;
    clearInterval(entry.timer);
    delete phraseStudioIndex.state.installPolls[voiceId];
  },
  tickInstallPoll: function tickInstallPoll(voiceId) {
    var entry = phraseStudioIndex.state.installPolls[voiceId];
    if (!entry) return;
    entry.attempts += 1;

    if (entry.attempts > phraseStudioIndex.INSTALL_POLL_MAX_ATTEMPTS) {
      phraseStudioIndex.cancelInstallPoll(voiceId); // We deliberately do NOT DELETE the row here: the cap is set
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
      dataType: 'json'
    }).done(function (response) {
      var list = response && response.data || [];
      phraseStudioIndex.state.voices = list;
      phraseStudioIndex.renderVoicesTable();
      phraseStudioIndex.renderVoicePicker();
      var voice = list.find(function (v) {
        return v.voice_id === voiceId;
      });

      if (!voice) {
        // Row vanished (user pressed Remove mid-install): drop the timer.
        phraseStudioIndex.cancelInstallPoll(voiceId);
        return;
      }

      if (voice.install_status === 'installed') {
        phraseStudioIndex.cancelInstallPoll(voiceId); // No toast — the row already turned green with the new status
        // and the action button became Remove. Failures still toast,
        // because install_error needs surfacing somewhere.

        return;
      }

      if (voice.install_status === 'failed') {
        phraseStudioIndex.cancelInstallPoll(voiceId);
        var detail = voice.install_error ? "".concat(globalTranslate.module_phrase_studio_ErrorVoiceInstall, " ").concat(voice.install_error) : globalTranslate.module_phrase_studio_ErrorVoiceInstall;
        UserMessage.showMultiString(detail);
        return;
      } // status === 'installing' → keep ticking

    });
  },
  onVoiceUninstall: function onVoiceUninstall() {
    var $btn = $(this);
    var voiceId = $btn.data('voice');
    $btn.addClass('loading disabled'); // Cancel any in-flight install poll for this voice — Remove on a
    // 'failed' or 'installing' row should clear the placeholder cleanly.

    phraseStudioIndex.cancelInstallPoll(voiceId);
    $.ajax({
      url: "".concat(phraseStudioIndex.api.voices, "/").concat(encodeURIComponent(voiceId)),
      method: 'DELETE',
      dataType: 'json'
    }).done(function () {
      // No toast — the row reverts to the not-installed label and shows
      // an Install button, which is enough confirmation for a delete.
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

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNyYy9tb2R1bGUtcGhyYXNlLXN0dWRpby1pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBTSxpQkFBaUIsR0FBRztBQUN0QixFQUFBLEdBQUcsRUFBRTtBQUNELElBQUEsTUFBTSxFQUFTLDZDQURkO0FBRUQsSUFBQSxhQUFhLEVBQUUscURBRmQ7QUFHRCxJQUFBLE1BQU0sRUFBUyw2Q0FIZDtBQUlELElBQUEsWUFBWSxFQUFHLHFEQUpkO0FBS0QsSUFBQSxPQUFPLEVBQVEsOENBTGQ7QUFNRCxJQUFBLFlBQVksRUFBRyxhQUFhLEdBQUc7QUFOOUIsR0FEaUI7QUFVdEIsRUFBQSxLQUFLLEVBQUU7QUFDSCxJQUFBLE1BQU0sRUFBRSxJQURMO0FBRUgsSUFBQSxNQUFNLEVBQUUsRUFGTDtBQUdILElBQUEsWUFBWSxFQUFFLEVBSFg7QUFJSCxJQUFBLGdCQUFnQixFQUFFLElBSmY7QUFLSDtBQUNBO0FBQ0E7QUFDQSxJQUFBLFlBQVksRUFBRTtBQVJYLEdBVmU7QUFxQnRCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEVBQUEsd0JBQXdCLEVBQUUsSUE5Qko7QUErQnRCLEVBQUEseUJBQXlCLEVBQUUsR0EvQkw7QUFpQ3RCLEVBQUEsVUFqQ3NCLHdCQWlDVDtBQUNULElBQUEsQ0FBQyxDQUFDLCtCQUFELENBQUQsQ0FBbUMsR0FBbkM7QUFDQSxJQUFBLENBQUMsQ0FBQyxrQ0FBRCxDQUFELENBQXNDLFFBQXRDO0FBQ0EsSUFBQSxDQUFDLENBQUMsNEJBQUQsQ0FBRCxDQUFnQyxRQUFoQyxHQUhTLENBS1Q7QUFDQTtBQUNBOztBQUNBLFFBQUksQ0FBQyxNQUFNLENBQUMsb0JBQVAsSUFBK0IsRUFBaEMsRUFBb0MsUUFBeEMsRUFBa0Q7QUFDOUMsTUFBQSxDQUFDLENBQUMseUNBQ0ksZ0NBREwsQ0FBRCxDQUN3QyxJQUR4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QUFDLFFBQUQsQ0FBRCxDQUFZLEtBQVosQ0FBa0IsWUFBTTtBQUNwQixFQUFBLGlCQUFpQixDQUFDLFVBQWxCO0FBQ0gsQ0FGRCIsImZpbGUiOiJtb2R1bGUtcGhyYXNlLXN0dWRpby1pbmRleC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8qIGdsb2JhbCAkLCBnbG9iYWxSb290VXJsLCBnbG9iYWxUcmFuc2xhdGUsIFBieEFwaSwgVXNlck1lc3NhZ2UsIEluZGV4U291bmRQbGF5ZXIsIFRva2VuTWFuYWdlciwgU2VtYW50aWNMb2NhbGl6YXRpb24gKi9cblxuLyoqXG4gKiBTdHVkaW8gcGFnZSBjb250cm9sbGVyIGZvciBNb2R1bGVQaHJhc2VTdHVkaW8uXG4gKlxuICogVGhlIHBhZ2UgaGFzIGZvdXIgdGFicyAoc3R1ZGlvIC8gdm9pY2VzIC8gZW5naW5lIC8gaGlzdG9yeSkuIEFsbCBkYXRhIGZsb3dzXG4gKiB0aHJvdWdoIHRoZSBtb2R1bGUncyBSRVNUIHYzIGVuZHBvaW50cyB1bmRlciAvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8uXG4gKiBXZSByZWx5IG9uIFBieEFwaS5jYWxsSnNvblJlc3QgaGVscGVyLCB3aGljaCBhbHJlYWR5IGhhbmRsZXMgYXV0aCBoZWFkZXJzLlxuICovXG5jb25zdCBwaHJhc2VTdHVkaW9JbmRleCA9IHtcbiAgICBhcGk6IHtcbiAgICAgICAgZW5naW5lOiAgICAgICAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby9lbmdpbmUnLFxuICAgICAgICBlbmdpbmVJbnN0YWxsOiAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL2VuZ2luZTppbnN0YWxsJyxcbiAgICAgICAgdm9pY2VzOiAgICAgICAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby92b2ljZXMnLFxuICAgICAgICB2b2ljZUluc3RhbGw6ICAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL3ZvaWNlczppbnN0YWxsJyxcbiAgICAgICAgcGhyYXNlczogICAgICAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby9waHJhc2VzJyxcbiAgICAgICAgc2F2ZURlZmF1bHRzOiAgZ2xvYmFsUm9vdFVybCArICdtb2R1bGUtcGhyYXNlLXN0dWRpby9tb2R1bGUtcGhyYXNlLXN0dWRpby9zYXZlJyxcbiAgICB9LFxuXG4gICAgc3RhdGU6IHtcbiAgICAgICAgZW5naW5lOiBudWxsLFxuICAgICAgICB2b2ljZXM6IFtdLFxuICAgICAgICBzb3VuZFBsYXllcnM6IHt9LFxuICAgICAgICBoaXN0b3J5RGF0YVRhYmxlOiBudWxsLFxuICAgICAgICAvLyB2b2ljZV9pZCDihpIgeyBzdGFydGVkQXQsIGF0dGVtcHRzLCB0aW1lciB9IGZvciBpbnN0YWxscyBpbiBmbGlnaHQuXG4gICAgICAgIC8vIFRyYWNraW5nIGF0dGVtcHRzIGNsaWVudC1zaWRlIGxldHMgdXMgY2FwIHBvbGxpbmcgYXQgfjEwIG1pbnV0ZXNcbiAgICAgICAgLy8gZXZlbiBpZiB0aGUgd29ya2VyIHNpbGVudGx5IGRpZXMsIGluc3RlYWQgb2Ygc3Bpbm5pbmcgZm9yZXZlci5cbiAgICAgICAgaW5zdGFsbFBvbGxzOiB7fSxcbiAgICB9LFxuXG4gICAgLy8gVm9pY2UgaW5zdGFsbCBwb2xsaW5nOiAzLXNlY29uZCB0aWNrIMOXIDUwMCBhdHRlbXB0cyDiiYggMjUgbWludXRlcy5cbiAgICAvLyBUaGUgZGV0YWNoZWQgYGluc3RhbGwtdm9pY2UucGhwYCBydW5uZXIgdXNlcyBgY3VybCAtLW1heC10aW1lIDYwMGBcbiAgICAvLyBwZXIgYXNzZXQgKMOXMiBmaWxlcyA9IDIwLW1pbnV0ZSBoYXJkIGJhY2tlbmQgY2VpbGluZykuIFRoZSBwb2xsIGNhcFxuICAgIC8vIG11c3Qgc2l0IEFCT1ZFIHRoYXQgY2VpbGluZyDigJQgb3RoZXJ3aXNlIGEgc2xvdy1idXQtc3RpbGwtcnVubmluZ1xuICAgIC8vIGRvd25sb2FkIGlzIG1pc3Rha2VuIGZvciBhIGNyYXNoLCB0aGUgSlMgYmFpbHMsIGFuZCB0aGUgdXNlciBpcyBsZWZ0XG4gICAgLy8gd2l0aCBhIHN0dWNrIFVJIGV2ZW4gdGhvdWdoIHRoZSB3b3JrZXIgaXMgc3RpbGwgd3JpdGluZyB0aGUgZmlsZS5cbiAgICAvLyBCZXlvbmQgMjUgbWludXRlcyB3ZSBoYW5kIHJlY292ZXJ5IG9mZiB0byB0aGUgc2VydmVyLXNpZGUgc3dlZXBlclxuICAgIC8vICgzMCBtaW4sIEdldExpc3RBY3Rpb246OnN3ZWVwU3RhbGVJbnN0YWxscyksIHdoaWNoIGZsaXBzIHRoZSByb3cgdG9cbiAgICAvLyBgZmFpbGVkYCBhbmQgdGhlIG5leHQgcmVmcmVzaCBzaG93cyB0aGUgc3RhbmRhcmQgUmV0cnkgYnV0dG9uLlxuICAgIElOU1RBTExfUE9MTF9JTlRFUlZBTF9NUzogMzAwMCxcbiAgICBJTlNUQUxMX1BPTExfTUFYX0FUVEVNUFRTOiA1MDAsXG5cbiAgICBpbml0aWFsaXplKCkge1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10YWItbWVudSAuaXRlbScpLnRhYigpO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1yZW1lbWJlci1jaGVja2JveCcpLmNoZWNrYm94KCk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXNhbXBsZS1yYXRlJykuZHJvcGRvd24oKTtcblxuICAgICAgICAvLyBNb2R1bGUgZGlzYWJsZWQg4oaSIHBhZ2UgaXMgcmVhZC1vbmx5LCBza2lwIFJFU1QgcG9sbGluZyBhbmRcbiAgICAgICAgLy8gZGlzYWJsZSB0aGUgZm9ybSBpbnB1dHMuIEF2b2lkcyB0aGUgXCJmYWlsZWQgdG8gbG9hZCB2b2ljZXNcIlxuICAgICAgICAvLyBlcnJvciBwb3B1cCB1c2VycyBnb3Qgd2hlbiBvcGVuaW5nIGEgZGlzYWJsZWQgbW9kdWxlJ3MgcGFnZS5cbiAgICAgICAgaWYgKCh3aW5kb3cucGhyYXNlU3R1ZGlvRGVmYXVsdHMgfHwge30pLmRpc2FibGVkKSB7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1nZW5lcmF0ZS1mb3JtIDppbnB1dCwnXG4gICAgICAgICAgICAgICAgKyAnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtYnV0dG9uJykucHJvcCgnZGlzYWJsZWQnLCB0cnVlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS5vbignaW5wdXQnLCBwaHJhc2VTdHVkaW9JbmRleC51cGRhdGVDb3VudGVyKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtYnV0dG9uJykub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25HZW5lcmF0ZSk7XG4gICAgICAgICQoJ1tkYXRhLXRhYj1cInZvaWNlc1wiXScpLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMpO1xuICAgICAgICAkKCdbZGF0YS10YWI9XCJlbmdpbmVcIl0nKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKTtcbiAgICAgICAgJCgnW2RhdGEtdGFiPVwiaGlzdG9yeVwiXScpLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hIaXN0b3J5KTtcblxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5hcHBseURlZmF1bHRzKCk7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hFbmdpbmUoKTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaFZvaWNlcygpO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoSGlzdG9yeSgpO1xuICAgIH0sXG5cbiAgICBhcHBseURlZmF1bHRzKCkge1xuICAgICAgICBjb25zdCBkID0gd2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzIHx8IHt9O1xuICAgICAgICBpZiAoZC5zYW1wbGVSYXRlKSB7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1zYW1wbGUtcmF0ZScpLmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCBkLnNhbXBsZVJhdGUpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZUNvdW50ZXIoKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gJCgnI3BocmFzZS1zdHVkaW8tdGV4dCcpLnZhbCgpIHx8ICcnO1xuICAgICAgICBjb25zdCBtYXggICA9IHBhcnNlSW50KCQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS5hdHRyKCdtYXhsZW5ndGgnKSB8fCAnODAwJywgMTApO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0LWNvdW50ZXInKS50ZXh0KGAke3ZhbHVlLmxlbmd0aH0gLyAke21heH1gKTtcbiAgICB9LFxuXG4gICAgcmVmcmVzaEVuZ2luZSgpIHtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLmVuZ2luZSxcbiAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuZW5naW5lID0gKHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGEpIHx8IG51bGw7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJFbmdpbmUoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yRW5naW5lU3RhdHVzKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckVuZ2luZSgpIHtcbiAgICAgICAgY29uc3QgJGJveCA9ICQoJyNwaHJhc2Utc3R1ZGlvLWVuZ2luZS1zdGF0dXMnKS5lbXB0eSgpO1xuICAgICAgICBjb25zdCBkYXRhID0gcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuZW5naW5lIHx8IHt9O1xuICAgICAgICBpZiAoZGF0YS5pbnN0YWxsZWQpIHtcbiAgICAgICAgICAgICRib3guYXBwZW5kKFxuICAgICAgICAgICAgICAgICQoJzxkaXY+JykuYWRkQ2xhc3MoJ3VpIHBvc2l0aXZlIG1lc3NhZ2UnKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCQoJzxkaXY+JykuYWRkQ2xhc3MoJ2hlYWRlcicpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZUluc3RhbGxlZCkpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJCgnPHA+JykudGV4dChgJHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lVmVyc2lvbn06ICR7ZGF0YS52ZXJzaW9uIHx8ICfigJQnfWApKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgJCgnPGJ1dHRvbj4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5hZGRDbGFzcygndWkgc21hbGwgcmVkIGJhc2ljIGJ1dHRvbicpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZVVuaW5zdGFsbClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25FbmdpbmVVbmluc3RhbGwpXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAkYm94LmFwcGVuZChcbiAgICAgICAgICAgICAgICAkKCc8ZGl2PicpLmFkZENsYXNzKCd1aSB3YXJuaW5nIG1lc3NhZ2UnKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCQoJzxkaXY+JykuYWRkQ2xhc3MoJ2hlYWRlcicpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZU5vdEluc3RhbGxlZCkpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJCgnPHA+JykudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lSW5zdGFsbEhpbnQpKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgJCgnPGJ1dHRvbj4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5hZGRDbGFzcygndWkgcHJpbWFyeSBidXR0b24nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVJbnN0YWxsKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5vbkVuZ2luZUluc3RhbGwpXG4gICAgICAgICAgICAgICAgICAgIClcbiAgICAgICAgICAgICk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgb25FbmdpbmVJbnN0YWxsKCkge1xuICAgICAgICBjb25zdCAkYnRuID0gJCh0aGlzKTtcbiAgICAgICAgJGJ0bi5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkuZW5naW5lSW5zdGFsbCxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hFbmdpbmUoKTtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5yZXN1bHQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKHJlc3BvbnNlLm1lc3NhZ2VzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yRW5naW5lSW5zdGFsbCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBvbkVuZ2luZVVuaW5zdGFsbCgpIHtcbiAgICAgICAgY29uc3QgJGJ0biA9ICQodGhpcyk7XG4gICAgICAgICRidG4uYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLmVuZ2luZSxcbiAgICAgICAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKCgpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hFbmdpbmUoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yRW5naW5lVW5pbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlZnJlc2hWb2ljZXMoKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS52b2ljZXMsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnZvaWNlcyA9IChyZXNwb25zZSAmJiByZXNwb25zZS5kYXRhKSB8fCBbXTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlbmRlclZvaWNlc1RhYmxlKCk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJWb2ljZVBpY2tlcigpO1xuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZXNMaXN0KTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRyYW5zbGF0ZXMgYSBQaXBlciBsYW5ndWFnZSB0YWcgKGUuZy4gJ3J1LXJ1JywgJ2VuLXVzJywgJ3B0LWJyJylcbiAgICAgKiBpbnRvIGEgU2VtYW50aWMgVUkgZmxhZyBjbGFzcy4gVGhlIHNlY29uZCBzZWdtZW50IGlzIGFscmVhZHkgYW5cbiAgICAgKiBJU08gMzE2Ni0xIGFscGhhLTIgY291bnRyeSBjb2RlIGluIHRoZSBjYXRhbG9ndWUsIHNvIHdlIGp1c3RcbiAgICAgKiBleHRyYWN0IGFuZCBsb3dlcmNhc2UgaXQuIFVua25vd24gdGFncyBmYWxsIGJhY2sgdG8gbm8gZmxhZy5cbiAgICAgKi9cbiAgICBmbGFnQ2xhc3NGb3IobGFuZ3VhZ2UpIHtcbiAgICAgICAgaWYgKCFsYW5ndWFnZSkgcmV0dXJuICcnO1xuICAgICAgICBjb25zdCBwYXJ0cyA9IFN0cmluZyhsYW5ndWFnZSkudG9Mb3dlckNhc2UoKS5zcGxpdCgnLScpO1xuICAgICAgICBjb25zdCBjYyA9IHBhcnRzW3BhcnRzLmxlbmd0aCAtIDFdO1xuICAgICAgICBpZiAoIWNjIHx8IGNjLmxlbmd0aCAhPT0gMikgcmV0dXJuICcnO1xuICAgICAgICByZXR1cm4gY2M7XG4gICAgfSxcblxuICAgIHJlbmRlclZvaWNlc1RhYmxlKCkge1xuICAgICAgICBjb25zdCAkdGJvZHkgPSAkKCcjcGhyYXNlLXN0dWRpby12b2ljZXMtdGFibGUgdGJvZHknKS5lbXB0eSgpO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS52b2ljZXMuZm9yRWFjaCgodm9pY2UpID0+IHtcbiAgICAgICAgICAgIGNvbnN0ICRyb3cgPSAkKCc8dHI+JykuYXR0cignZGF0YS12b2ljZScsIHZvaWNlLnZvaWNlX2lkKTtcbiAgICAgICAgICAgIGNvbnN0IGZsYWcgPSBwaHJhc2VTdHVkaW9JbmRleC5mbGFnQ2xhc3NGb3Iodm9pY2UubGFuZ3VhZ2UpO1xuICAgICAgICAgICAgY29uc3QgJGxhbmcgPSAkKCc8dGQ+Jyk7XG4gICAgICAgICAgICBpZiAoZmxhZykge1xuICAgICAgICAgICAgICAgICRsYW5nLmFwcGVuZChgPGkgY2xhc3M9XCIke2ZsYWd9IGZsYWdcIj48L2k+YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkbGFuZy5hcHBlbmQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoYCR7dm9pY2UubGFuZ3VhZ2VfbGFiZWx9ICgke3ZvaWNlLmxhbmd1YWdlfSlgKSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkbGFuZyk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykudGV4dCh2b2ljZS52b2ljZV9uYW1lKSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykudGV4dCh2b2ljZS5xdWFsaXR5KSk7XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkKCc8dGQ+JykudGV4dChgJHt2b2ljZS5zYW1wbGVfcmF0ZX0gSHpgKSk7XG5cbiAgICAgICAgICAgIGNvbnN0IHN0YXR1cyA9IHZvaWNlLmluc3RhbGxfc3RhdHVzIHx8ICh2b2ljZS5pbnN0YWxsZWQgPyAnaW5zdGFsbGVkJyA6ICcnKTtcbiAgICAgICAgICAgIGNvbnN0ICRzdGF0dXNDZWxsID0gJCgnPHRkPicpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyA9PT0gJ2luc3RhbGxlZCcpIHtcbiAgICAgICAgICAgICAgICAkc3RhdHVzQ2VsbC5odG1sKGA8c3BhbiBjbGFzcz1cInVpIGdyZWVuIGxhYmVsXCI+JHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VJbnN0YWxsZWR9PC9zcGFuPmApO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChzdGF0dXMgPT09ICdpbnN0YWxsaW5nJykge1xuICAgICAgICAgICAgICAgICRzdGF0dXNDZWxsLmh0bWwoXG4gICAgICAgICAgICAgICAgICAgICc8ZGl2IGNsYXNzPVwidWkgYWN0aXZlIGlubGluZSBtaW5pIGxvYWRlclwiPjwvZGl2PiAnXG4gICAgICAgICAgICAgICAgICAgICsgYDxzcGFuIGNsYXNzPVwidWkgeWVsbG93IGxhYmVsXCI+JHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VJbnN0YWxsaW5nfTwvc3Bhbj5gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdHVzID09PSAnZmFpbGVkJykge1xuICAgICAgICAgICAgICAgIGNvbnN0IGVyciA9IHZvaWNlLmluc3RhbGxfZXJyb3IgfHwgJyc7XG4gICAgICAgICAgICAgICAgJHN0YXR1c0NlbGwuaHRtbChcbiAgICAgICAgICAgICAgICAgICAgYDxzcGFuIGNsYXNzPVwidWkgcmVkIGxhYmVsXCIgdGl0bGU9XCIkeyQoJzxkaXY+JykudGV4dChlcnIpLmh0bWwoKX1cIj5gXG4gICAgICAgICAgICAgICAgICAgICsgYCR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlRmFpbGVkfTwvc3Bhbj5gXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgJHN0YXR1c0NlbGwuaHRtbChgPHNwYW4gY2xhc3M9XCJ1aSBsYWJlbFwiPiR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlTm90SW5zdGFsbGVkfTwvc3Bhbj5gKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICRyb3cuYXBwZW5kKCRzdGF0dXNDZWxsKTtcblxuICAgICAgICAgICAgY29uc3QgJGFjdGlvbnMgPSAkKCc8dGQ+JykuYWRkQ2xhc3MoJ3JpZ2h0IGFsaWduZWQnKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgPT09ICdpbnN0YWxsZWQnKSB7XG4gICAgICAgICAgICAgICAgJGFjdGlvbnMuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpLmFkZENsYXNzKCd1aSBzbWFsbCBiYXNpYyByZWQgaWNvbiBidXR0b24nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ2RhdGEtdm9pY2UnLCB2b2ljZS52b2ljZV9pZClcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCd0aXRsZScsIGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZURlbGV0ZSlcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJzxpIGNsYXNzPVwidHJhc2ggaWNvblwiPjwvaT4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uVm9pY2VVbmluc3RhbGwpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdHVzID09PSAnaW5zdGFsbGluZycpIHtcbiAgICAgICAgICAgICAgICAvLyBXaGlsZSB0aGUgd29ya2VyIGlzIGRvd25sb2FkaW5nIHdlIGxvY2sgdGhlIGFjdGlvbiBjZWxsIOKAlFxuICAgICAgICAgICAgICAgIC8vIHNob3dpbmcgYSBkaXNhYmxlZCBzcGlubmVyIG1ha2VzIHRoZSBpbi1mbGlnaHQgc3RhdGUgcmVhZFxuICAgICAgICAgICAgICAgIC8vIGNsZWFybHkgYW5kIHByZXZlbnRzIGRvdWJsZS1wdWJsaXNoIG9uIGltcGF0aWVudCBjbGlja3MuXG4gICAgICAgICAgICAgICAgJGFjdGlvbnMuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpLmFkZENsYXNzKCd1aSBzbWFsbCBwcmltYXJ5IGljb24gYnV0dG9uIGxvYWRpbmcgZGlzYWJsZWQnKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ2RhdGEtdm9pY2UnLCB2b2ljZS52b2ljZV9pZClcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCd0aXRsZScsIGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZUluc3RhbGxpbmcpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCc8aSBjbGFzcz1cImRvd25sb2FkIGljb25cIj48L2k+JylcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAvLyAnZmFpbGVkJyBhbmQgbm90LWluc3RhbGxlZCBzaGFyZSB0aGUgc2FtZSBhY3Rpb24gYnV0dG9uIOKAlFxuICAgICAgICAgICAgICAgIC8vIGJvdGggcmVzdWx0IGluIHB1Ymxpc2hpbmcgYSBmcmVzaCBpbnN0YWxsX3ZvaWNlIGpvYi5cbiAgICAgICAgICAgICAgICBjb25zdCBsYWJlbCA9IHN0YXR1cyA9PT0gJ2ZhaWxlZCdcbiAgICAgICAgICAgICAgICAgICAgPyBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VSZXRyeVxuICAgICAgICAgICAgICAgICAgICA6IGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZUluc3RhbGw7XG4gICAgICAgICAgICAgICAgJGFjdGlvbnMuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpLmFkZENsYXNzKCd1aSBzbWFsbCBwcmltYXJ5IGljb24gYnV0dG9uJylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCdkYXRhLXZvaWNlJywgdm9pY2Uudm9pY2VfaWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cigndGl0bGUnLCBsYWJlbClcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJzxpIGNsYXNzPVwiZG93bmxvYWQgaWNvblwiPjwvaT4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uVm9pY2VJbnN0YWxsKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkYWN0aW9ucyk7XG4gICAgICAgICAgICAkdGJvZHkuYXBwZW5kKCRyb3cpO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBSZS1hcm0gcG9sbGluZyBmb3IgYW55IHZvaWNlIHRoZSBzZXJ2ZXIgc3RpbGwgcmVwb3J0cyBhc1xuICAgICAgICAvLyAnaW5zdGFsbGluZycgKGNvdmVycyBwYWdlIHJlbG9hZHMgbWlkLWluc3RhbGwpLlxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS52b2ljZXNcbiAgICAgICAgICAgIC5maWx0ZXIoKHYpID0+IHYuaW5zdGFsbF9zdGF0dXMgPT09ICdpbnN0YWxsaW5nJylcbiAgICAgICAgICAgIC5mb3JFYWNoKCh2KSA9PiBwaHJhc2VTdHVkaW9JbmRleC5zY2hlZHVsZUluc3RhbGxQb2xsKHYudm9pY2VfaWQpKTtcbiAgICB9LFxuXG4gICAgcmVuZGVyVm9pY2VQaWNrZXIoKSB7XG4gICAgICAgIGNvbnN0ICRzZWxlY3QgPSAkKCcjcGhyYXNlLXN0dWRpby12b2ljZScpO1xuICAgICAgICBjb25zdCBwcmV2aW91cyA9ICRzZWxlY3QudmFsKCk7XG4gICAgICAgIGNvbnN0IGZhbGxiYWNrID0gKHdpbmRvdy5waHJhc2VTdHVkaW9EZWZhdWx0cyB8fCB7fSkudm9pY2UgfHwgJyc7XG4gICAgICAgICRzZWxlY3QuZW1wdHkoKTtcbiAgICAgICAgY29uc3QgaW5zdGFsbGVkID0gcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzLmZpbHRlcigodikgPT4gdi5pbnN0YWxsZWQpO1xuICAgICAgICBpZiAoaW5zdGFsbGVkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgJHNlbGVjdC5hcHBlbmQoJCgnPG9wdGlvbj4nKS52YWwoJycpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1BpY2tlckVtcHR5KSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpbnN0YWxsZWQuZm9yRWFjaCgodm9pY2UpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBmbGFnID0gcGhyYXNlU3R1ZGlvSW5kZXguZmxhZ0NsYXNzRm9yKHZvaWNlLmxhbmd1YWdlKTtcbiAgICAgICAgICAgICAgICAvLyBTZW1hbnRpYyBVSSBkcm9wZG93biByZWFkcyBgZGF0YS10ZXh0YCBmb3IgdGhlIGRpc3BsYXkgc3RyaW5nXG4gICAgICAgICAgICAgICAgLy8gYW5kIHJlbmRlcnMgYSBmbGFnIGZyb20gYGRhdGEtZmxhZ2Agd2hlbiBwcmVzZW50LCBzbyB0aGUgY2hvc2VuXG4gICAgICAgICAgICAgICAgLy8gb3B0aW9uIGtlZXBzIHRoZSBpY29uIGFmdGVyIHNlbGVjdGlvbi5cbiAgICAgICAgICAgICAgICBjb25zdCAkb3B0ID0gJCgnPG9wdGlvbj4nKVxuICAgICAgICAgICAgICAgICAgICAudmFsKHZvaWNlLnZvaWNlX2lkKVxuICAgICAgICAgICAgICAgICAgICAudGV4dChgJHt2b2ljZS5sYW5ndWFnZV9sYWJlbH0g4oCUICR7dm9pY2Uudm9pY2VfbmFtZX0gKCR7dm9pY2UucXVhbGl0eX0pYCk7XG4gICAgICAgICAgICAgICAgaWYgKGZsYWcpIHtcbiAgICAgICAgICAgICAgICAgICAgJG9wdC5hdHRyKCdkYXRhLWZsYWcnLCBmbGFnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgJHNlbGVjdC5hcHBlbmQoJG9wdCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICAkc2VsZWN0LmRyb3Bkb3duKHtmdWxsVGV4dFNlYXJjaDogdHJ1ZX0pO1xuICAgICAgICBjb25zdCB3YW50ID0gcHJldmlvdXMgfHwgZmFsbGJhY2s7XG4gICAgICAgIGlmICh3YW50KSB7XG4gICAgICAgICAgICAkc2VsZWN0LmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCB3YW50KTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBvblZvaWNlSW5zdGFsbCgpIHtcbiAgICAgICAgY29uc3QgJGJ0biA9ICQodGhpcyk7XG4gICAgICAgIGNvbnN0IHZvaWNlSWQgPSAkYnRuLmRhdGEoJ3ZvaWNlJyk7XG4gICAgICAgIC8vIExvY2sgdGhlIGJ1dHRvbiBpbW1lZGlhdGVseSBzbyBpbXBhdGllbnQgZG91YmxlLWNsaWNrcyBjYW4ndCBxdWV1ZVxuICAgICAgICAvLyBhIGR1cGxpY2F0ZSBpbnN0YWxsLiBUaGUgYnV0dG9uIHN0YXlzIGRpc2FibGVkIHVudGlsIHJlZnJlc2hWb2ljZXNcbiAgICAgICAgLy8gcmUtcmVuZGVycyB0aGUgcm93IGZyb20gdGhlIG5ldyBpbnN0YWxsX3N0YXR1cy5cbiAgICAgICAgJGJ0bi5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VJbnN0YWxsLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBkYXRhOiBKU09OLnN0cmluZ2lmeSh7dm9pY2VfaWQ6IHZvaWNlSWR9KSxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKHJlc3BvbnNlLm1lc3NhZ2VzXG4gICAgICAgICAgICAgICAgICAgIHx8IGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvclZvaWNlSW5zdGFsbCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gQmFja2VuZCByZXR1cm5zIDIwMiB3aXRoIGluc3RhbGxfc3RhdHVzPSdpbnN0YWxsaW5nJyBiZWZvcmUgdGhlXG4gICAgICAgICAgICAvLyB3b3JrZXIgYWN0dWFsbHkgcnVucyBjdXJsLiBUaGUgcm93IHNwaW5uZXIgKyBcIkRvd25sb2FkaW5n4oCmXCIgbGFiZWxcbiAgICAgICAgICAgIC8vIGFuZCB0aGUgZGlzYWJsZWQgYWN0aW9uIGJ1dHRvbiBhbHJlYWR5IGNvbnZleSB0aGUgaW4tZmxpZ2h0IHN0YXRlXG4gICAgICAgICAgICAvLyDigJQgbm8gdG9hc3QgbmVlZGVkLlxuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaFZvaWNlcygpO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc2NoZWR1bGVJbnN0YWxsUG9sbCh2b2ljZUlkKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VJbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFBvbGxzIEdFVCAvdm9pY2VzIGZvciB0aGUgZ2l2ZW4gdm9pY2VfaWQgdW50aWwgaW5zdGFsbF9zdGF0dXMgZmxpcHNcbiAgICAgKiBvdXQgb2YgJ2luc3RhbGxpbmcnLiBSZS1lbnRyYW50OiBzY2hlZHVsaW5nIHRoZSBzYW1lIHZvaWNlIHdoaWxlIGFcbiAgICAgKiB0aW1lciBpcyBhbHJlYWR5IHBlbmRpbmcgaXMgYSBuby1vcCAoY292ZXJzIGRvdWJsZS1yZW5kZXJzIHRyaWdnZXJlZFxuICAgICAqIGJ5IHRhYiBzd2l0Y2hlcyBhbmQgY29uY3VycmVudCByZWZyZXNoVm9pY2VzIGNhbGxzKS5cbiAgICAgKi9cbiAgICBzY2hlZHVsZUluc3RhbGxQb2xsKHZvaWNlSWQpIHtcbiAgICAgICAgY29uc3QgcG9sbHMgPSBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5pbnN0YWxsUG9sbHM7XG4gICAgICAgIGlmIChwb2xsc1t2b2ljZUlkXSkgcmV0dXJuO1xuICAgICAgICBwb2xsc1t2b2ljZUlkXSA9IHtzdGFydGVkQXQ6IERhdGUubm93KCksIGF0dGVtcHRzOiAwfTtcbiAgICAgICAgcG9sbHNbdm9pY2VJZF0udGltZXIgPSBzZXRJbnRlcnZhbChcbiAgICAgICAgICAgICgpID0+IHBocmFzZVN0dWRpb0luZGV4LnRpY2tJbnN0YWxsUG9sbCh2b2ljZUlkKSxcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LklOU1RBTExfUE9MTF9JTlRFUlZBTF9NU1xuICAgICAgICApO1xuICAgIH0sXG5cbiAgICBjYW5jZWxJbnN0YWxsUG9sbCh2b2ljZUlkKSB7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0gcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaW5zdGFsbFBvbGxzW3ZvaWNlSWRdO1xuICAgICAgICBpZiAoIWVudHJ5KSByZXR1cm47XG4gICAgICAgIGNsZWFySW50ZXJ2YWwoZW50cnkudGltZXIpO1xuICAgICAgICBkZWxldGUgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaW5zdGFsbFBvbGxzW3ZvaWNlSWRdO1xuICAgIH0sXG5cbiAgICB0aWNrSW5zdGFsbFBvbGwodm9pY2VJZCkge1xuICAgICAgICBjb25zdCBlbnRyeSA9IHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmluc3RhbGxQb2xsc1t2b2ljZUlkXTtcbiAgICAgICAgaWYgKCFlbnRyeSkgcmV0dXJuO1xuICAgICAgICBlbnRyeS5hdHRlbXB0cyArPSAxO1xuICAgICAgICBpZiAoZW50cnkuYXR0ZW1wdHMgPiBwaHJhc2VTdHVkaW9JbmRleC5JTlNUQUxMX1BPTExfTUFYX0FUVEVNUFRTKSB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5jYW5jZWxJbnN0YWxsUG9sbCh2b2ljZUlkKTtcbiAgICAgICAgICAgIC8vIFdlIGRlbGliZXJhdGVseSBkbyBOT1QgREVMRVRFIHRoZSByb3cgaGVyZTogdGhlIGNhcCBpcyBzZXRcbiAgICAgICAgICAgIC8vIGFib3ZlIHRoZSBiYWNrZW5kJ3Mgd29yc3QtY2FzZSBjdXJsIHdpbmRvdywgYnV0IGEgZ2VudWluZWx5XG4gICAgICAgICAgICAvLyBzbG93IGluc3RhbGwgY2FuIHN0aWxsIGJlIHdyaXRpbmcgZmlsZXMuIFlhbmtpbmcgdGhlIHJvd1xuICAgICAgICAgICAgLy8gd291bGQgcmFjZSB3aXRoIHRoZSB3b3JrZXIncyBmaW5hbCBzYXZlIChvcnBoYW4gLm9ubngpIGFuZFxuICAgICAgICAgICAgLy8gZXJhc2UgYSByZWFsIHN1Y2Nlc3MgYSBmZXcgc2Vjb25kcyBiZWZvcmUgaXQgbGFuZHMuIEp1c3RcbiAgICAgICAgICAgIC8vIHN1cmZhY2UgYSBoaW50IGFuZCBsZXQgdGhlIHNlcnZlci1zaWRlIHN3ZWVwZXIgKDMwIG1pbixcbiAgICAgICAgICAgIC8vIEdldExpc3RBY3Rpb246OnN3ZWVwU3RhbGVJbnN0YWxscykgZmxpcCB0aGUgcm93IHRvIGBmYWlsZWRgXG4gICAgICAgICAgICAvLyBpZiB0aGUgZG93bmxvYWQgYWN0dWFsbHkgZGllZCDigJQgdGhlIFVJIHRoZW4gc2hvd3MgUmV0cnkuXG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbFRpbWVvdXQpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS52b2ljZXMsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGxpc3QgPSAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSkgfHwgW107XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS52b2ljZXMgPSBsaXN0O1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVyVm9pY2VzVGFibGUoKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlbmRlclZvaWNlUGlja2VyKCk7XG4gICAgICAgICAgICBjb25zdCB2b2ljZSA9IGxpc3QuZmluZCgodikgPT4gdi52b2ljZV9pZCA9PT0gdm9pY2VJZCk7XG4gICAgICAgICAgICBpZiAoIXZvaWNlKSB7XG4gICAgICAgICAgICAgICAgLy8gUm93IHZhbmlzaGVkICh1c2VyIHByZXNzZWQgUmVtb3ZlIG1pZC1pbnN0YWxsKTogZHJvcCB0aGUgdGltZXIuXG4gICAgICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguY2FuY2VsSW5zdGFsbFBvbGwodm9pY2VJZCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHZvaWNlLmluc3RhbGxfc3RhdHVzID09PSAnaW5zdGFsbGVkJykge1xuICAgICAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LmNhbmNlbEluc3RhbGxQb2xsKHZvaWNlSWQpO1xuICAgICAgICAgICAgICAgIC8vIE5vIHRvYXN0IOKAlCB0aGUgcm93IGFscmVhZHkgdHVybmVkIGdyZWVuIHdpdGggdGhlIG5ldyBzdGF0dXNcbiAgICAgICAgICAgICAgICAvLyBhbmQgdGhlIGFjdGlvbiBidXR0b24gYmVjYW1lIFJlbW92ZS4gRmFpbHVyZXMgc3RpbGwgdG9hc3QsXG4gICAgICAgICAgICAgICAgLy8gYmVjYXVzZSBpbnN0YWxsX2Vycm9yIG5lZWRzIHN1cmZhY2luZyBzb21ld2hlcmUuXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHZvaWNlLmluc3RhbGxfc3RhdHVzID09PSAnZmFpbGVkJykge1xuICAgICAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LmNhbmNlbEluc3RhbGxQb2xsKHZvaWNlSWQpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGRldGFpbCA9IHZvaWNlLmluc3RhbGxfZXJyb3JcbiAgICAgICAgICAgICAgICAgICAgPyBgJHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZUluc3RhbGx9ICR7dm9pY2UuaW5zdGFsbF9lcnJvcn1gXG4gICAgICAgICAgICAgICAgICAgIDogZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VJbnN0YWxsO1xuICAgICAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhkZXRhaWwpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIHN0YXR1cyA9PT0gJ2luc3RhbGxpbmcnIOKGkiBrZWVwIHRpY2tpbmdcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIG9uVm9pY2VVbmluc3RhbGwoKSB7XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKHRoaXMpO1xuICAgICAgICBjb25zdCB2b2ljZUlkID0gJGJ0bi5kYXRhKCd2b2ljZScpO1xuICAgICAgICAkYnRuLmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgIC8vIENhbmNlbCBhbnkgaW4tZmxpZ2h0IGluc3RhbGwgcG9sbCBmb3IgdGhpcyB2b2ljZSDigJQgUmVtb3ZlIG9uIGFcbiAgICAgICAgLy8gJ2ZhaWxlZCcgb3IgJ2luc3RhbGxpbmcnIHJvdyBzaG91bGQgY2xlYXIgdGhlIHBsYWNlaG9sZGVyIGNsZWFubHkuXG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LmNhbmNlbEluc3RhbGxQb2xsKHZvaWNlSWQpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBgJHtwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VzfS8ke2VuY29kZVVSSUNvbXBvbmVudCh2b2ljZUlkKX1gLFxuICAgICAgICAgICAgbWV0aG9kOiAnREVMRVRFJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKCkgPT4ge1xuICAgICAgICAgICAgLy8gTm8gdG9hc3Qg4oCUIHRoZSByb3cgcmV2ZXJ0cyB0byB0aGUgbm90LWluc3RhbGxlZCBsYWJlbCBhbmQgc2hvd3NcbiAgICAgICAgICAgIC8vIGFuIEluc3RhbGwgYnV0dG9uLCB3aGljaCBpcyBlbm91Z2ggY29uZmlybWF0aW9uIGZvciBhIGRlbGV0ZS5cbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VVbmluc3RhbGwpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgb25HZW5lcmF0ZSgpIHtcbiAgICAgICAgY29uc3QgdGV4dCAgICAgICA9ICgkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgY29uc3Qgdm9pY2VJZCAgICA9ICQoJyNwaHJhc2Utc3R1ZGlvLXZvaWNlJykudmFsKCkgfHwgJyc7XG4gICAgICAgIGNvbnN0IHNhbXBsZVJhdGUgPSAkKCcjcGhyYXNlLXN0dWRpby1zYW1wbGUtcmF0ZScpLnZhbCgpIHx8ICduYXRpdmUnO1xuICAgICAgICBpZiAoIXRleHQgfHwgIXZvaWNlSWQpIHtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVmFsaWRhdGlvbk1pc3NpbmcpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKCcjcGhyYXNlLXN0dWRpby1nZW5lcmF0ZS1idXR0b24nKS5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlcyxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoe3RleHQsIHZvaWNlX2lkOiB2b2ljZUlkLCBzYW1wbGVfcmF0ZTogc2FtcGxlUmF0ZX0pLFxuICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0gcmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YTtcbiAgICAgICAgICAgIGlmICghZGF0YSB8fCAhZGF0YS5waHJhc2VfaWQpIHtcbiAgICAgICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcocmVzcG9uc2UgJiYgcmVzcG9uc2UubWVzc2FnZXNcbiAgICAgICAgICAgICAgICAgICAgPyByZXNwb25zZS5tZXNzYWdlc1xuICAgICAgICAgICAgICAgICAgICA6IGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckdlbmVyYXRlKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoJCgnI3BocmFzZS1zdHVkaW8tcmVtZW1iZXInKS5pcygnOmNoZWNrZWQnKSkge1xuICAgICAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnBlcnNpc3REZWZhdWx0cyh2b2ljZUlkLCBzYW1wbGVSYXRlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIEhpc3RvcnkgdGFibGUgbGl2ZXMgcmlnaHQgdW5kZXIgdGhlIGZvcm0gb24gdGhlIFN0dWRpbyB0YWIsXG4gICAgICAgICAgICAvLyBzbyBhIHJlZnJlc2ggaXMgZW5vdWdoIOKAlCBubyB0YWIgc3dpdGNoLlxuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yR2VuZXJhdGUpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcGVyc2lzdERlZmF1bHRzKHZvaWNlSWQsIHNhbXBsZVJhdGUpIHtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLnNhdmVEZWZhdWx0cyxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YToge2RlZmF1bHRfdm9pY2U6IHZvaWNlSWQsIGRlZmF1bHRfc2FtcGxlX3JhdGU6IHNhbXBsZVJhdGV9LFxuICAgICAgICB9KS5kb25lKCgpID0+IHtcbiAgICAgICAgICAgIHdpbmRvdy5waHJhc2VTdHVkaW9EZWZhdWx0cyA9IHt2b2ljZTogdm9pY2VJZCwgc2FtcGxlUmF0ZX07XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZWZyZXNoSGlzdG9yeShjYWxsYmFjaykge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlcyxcbiAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVySGlzdG9yeSgocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSkgfHwgW10pO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZW5kZXJIaXN0b3J5KHJvd3MpIHtcbiAgICAgICAgLy8gVGVhciBkb3duIERhdGFUYWJsZSArIHNvdW5kIHBsYXllcnMgZnJvbSB0aGUgcHJldmlvdXMgcmVuZGVyLlxuICAgICAgICBpZiAocGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaGlzdG9yeURhdGFUYWJsZVxuICAgICAgICAgICAgJiYgJC5mbi5EYXRhVGFibGUuaXNEYXRhVGFibGUoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKSkge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaGlzdG9yeURhdGFUYWJsZS5kZXN0cm95KCk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBPYmplY3QudmFsdWVzKHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnNvdW5kUGxheWVycykuZm9yRWFjaCgocCkgPT4ge1xuICAgICAgICAgICAgaWYgKHAgJiYgcC5odG1sNUF1ZGlvKSB7XG4gICAgICAgICAgICAgICAgcC5odG1sNUF1ZGlvLnBhdXNlKCk7XG4gICAgICAgICAgICAgICAgcC5odG1sNUF1ZGlvLnNyYyA9ICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuc291bmRQbGF5ZXJzID0ge307XG5cbiAgICAgICAgY29uc3QgJHRib2R5ID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZSB0Ym9keScpLmVtcHR5KCk7XG4gICAgICAgIHJvd3MuZm9yRWFjaCgocm93KSA9PiB7XG4gICAgICAgICAgICAkdGJvZHkuYXBwZW5kKHBocmFzZVN0dWRpb0luZGV4LnJlbmRlckhpc3RvcnlSb3cocm93KSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0ICR0YWJsZVdyYXAgPSAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJykuY2xvc2VzdCgnLmRhdGFUYWJsZXNfd3JhcHBlcicpO1xuICAgICAgICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5oaWRlKCk7XG4gICAgICAgICAgICAoJHRhYmxlV3JhcC5sZW5ndGggPyAkdGFibGVXcmFwIDogJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpKS5oaWRlKCk7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LWVtcHR5Jykuc2hvdygpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktZW1wdHknKS5oaWRlKCk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5zaG93KCk7XG4gICAgICAgIGlmICgkdGFibGVXcmFwLmxlbmd0aCkge1xuICAgICAgICAgICAgJHRhYmxlV3JhcC5zaG93KCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJbml0aWFsaXNlIERhdGFUYWJsZSArIHNvdW5kIHBsYXllcnMsIG1pcnJvcmluZyBTb3VuZEZpbGVzIGluZGV4LlxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpLkRhdGFUYWJsZSh7XG4gICAgICAgICAgICBsZW5ndGhDaGFuZ2U6IGZhbHNlLFxuICAgICAgICAgICAgcGFnaW5nOiB0cnVlLFxuICAgICAgICAgICAgcGFnZUxlbmd0aDogMjUsXG4gICAgICAgICAgICBzZWFyY2hpbmc6IHRydWUsXG4gICAgICAgICAgICBpbmZvOiBmYWxzZSxcbiAgICAgICAgICAgIG9yZGVyaW5nOiB0cnVlLFxuICAgICAgICAgICAgbGFuZ3VhZ2U6IHR5cGVvZiBTZW1hbnRpY0xvY2FsaXphdGlvbiAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgICAgICAgICA/IFNlbWFudGljTG9jYWxpemF0aW9uLmRhdGFUYWJsZUxvY2FsaXNhdGlvblxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgb3JkZXI6IFtbMCwgJ2Rlc2MnXV0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJvd3MuZm9yRWFjaCgocm93KSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5zb3VuZFBsYXllcnNbcm93LmlkXSA9XG4gICAgICAgICAgICAgICAgbmV3IEluZGV4U291bmRQbGF5ZXIoYHBocmFzZS1yb3ctJHtyb3cuaWR9YCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFN0YW5kYXJkIE1pa29QQlggdHdvLXN0ZXAgZGVsZXRlIChkZWxldGUtc29tZXRoaW5nLmpzKSBmbGlwcyB0aGVcbiAgICAgICAgLy8gJ3R3by1zdGVwcy1kZWxldGUnIGNsYXNzIG9mZiBvbiB0aGUgZmlyc3QgY2xpY2suIFdlIGxpc3RlbiBmb3IgdGhlXG4gICAgICAgIC8vICpzZWNvbmQqIGNsaWNrICh3aGVuIHRoZSBjbGFzcyBpcyBnb25lKSB0byBmaXJlIHRoZSBSRVNUIERFTEVURS5cbiAgICAgICAgJCgnYm9keScpLm9mZignY2xpY2sucGhyYXNlU3R1ZGlvJyk7XG4gICAgICAgICQoJ2JvZHknKS5vbignY2xpY2sucGhyYXNlU3R1ZGlvJywgJ2EuZGVsZXRlOm5vdCgudHdvLXN0ZXBzLWRlbGV0ZSknLCBmdW5jdGlvbiBvbkNvbmZpcm1lZERlbGV0ZShlKSB7XG4gICAgICAgICAgICBjb25zdCAkdGFyZ2V0ID0gJChlLnRhcmdldCkuY2xvc2VzdCgnYS5kZWxldGUnKTtcbiAgICAgICAgICAgIGlmICgkdGFyZ2V0LmNsb3Nlc3QoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBlLnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgY29uc3QgaWQgPSAkdGFyZ2V0LmF0dHIoJ2RhdGEtdmFsdWUnKTtcbiAgICAgICAgICAgIGlmICghaWQpIHJldHVybjtcbiAgICAgICAgICAgICR0YXJnZXQuYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICAgICAgdXJsOiBgJHtwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlc30vJHtpZH1gLFxuICAgICAgICAgICAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgIH0pLmRvbmUoKCkgPT4gcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKSlcbiAgICAgICAgICAgICAgLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgJHRhcmdldC5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckhpc3RvcnlEZWxldGUpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0ICR0YmwgPSAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJyk7XG4gICAgICAgICR0YmwuZmluZCgnLnBvcHVwZWQnKS5wb3B1cCgpO1xuICAgICAgICAvLyBDbGljayBvbiB0aGUgdGV4dCBjZWxsIOKGkiBjb3B5IHBocmFzZSB0ZXh0ICsgdm9pY2UgYmFjayBpbnRvIHRoZSBmb3JtXG4gICAgICAgIC8vIHNvIHRoZSB1c2VyIGNhbiBlZGl0IGFuZCByZS1nZW5lcmF0ZSB3aXRob3V0IHJldHlwaW5nLiBLZWVwcyB0aGVcbiAgICAgICAgLy8gcGxheWVyIC8gZG93bmxvYWQgLyBkZWxldGUgYnV0dG9ucyBjbGlja2FibGUgb24gdGhlaXIgb3duLlxuICAgICAgICAkdGJsLm9mZignY2xpY2sucGhyYXNlU3R1ZGlvJyk7XG4gICAgICAgICR0Ymwub24oJ2NsaWNrLnBocmFzZVN0dWRpbycsICd0ZC5waHJhc2UtcmV1c2UnLCBmdW5jdGlvbiBvblJldXNlKCkge1xuICAgICAgICAgICAgY29uc3QgJHJvdyA9ICQodGhpcykuY2xvc2VzdCgndHInKTtcbiAgICAgICAgICAgIGNvbnN0IHRleHQgPSAkcm93LmF0dHIoJ2RhdGEtdGV4dCcpIHx8ICcnO1xuICAgICAgICAgICAgY29uc3Qgdm9pY2UgPSAkcm93LmF0dHIoJ2RhdGEtdm9pY2UnKSB8fCAnJztcbiAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS52YWwodGV4dCkudHJpZ2dlcignaW5wdXQnKTtcbiAgICAgICAgICAgIGlmICh2b2ljZSkge1xuICAgICAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXZvaWNlJykuZHJvcGRvd24oJ3NldCBzZWxlY3RlZCcsIHZvaWNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICQoJ2h0bWwsIGJvZHknKS5hbmltYXRlKHtzY3JvbGxUb3A6ICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS5vZmZzZXQoKS50b3AgLSA4MH0sIDIwMCk7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykuZm9jdXMoKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckhpc3RvcnlSb3cocm93KSB7XG4gICAgICAgIGNvbnN0IGNyZWF0ZWQgICA9IHJvdy5jcmVhdGVkX2F0ID8gbmV3IERhdGUocm93LmNyZWF0ZWRfYXQgKiAxMDAwKS50b0xvY2FsZVN0cmluZygpIDogJ+KAlCc7XG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ICA9IHJvdy50ZXh0IHx8ICcnO1xuICAgICAgICBjb25zdCBzaG9ydFRleHQgPSBmdWxsVGV4dC5sZW5ndGggPiA4MCA/IGAke2Z1bGxUZXh0LnN1YnN0cmluZygwLCA4MCl94oCmYCA6IGZ1bGxUZXh0O1xuICAgICAgICBjb25zdCB2b2ljZUlkICAgPSByb3cudm9pY2VfaWQgfHwgJyc7XG4gICAgICAgIGNvbnN0IHBsYXlVcmwgICA9IGAke3BocmFzZVN0dWRpb0luZGV4LmFwaS5waHJhc2VzfS8ke3Jvdy5pZH06ZG93bmxvYWRgO1xuICAgICAgICBjb25zdCBkbFVybCAgICAgPSBwbGF5VXJsO1xuICAgICAgICBjb25zdCBmaWxlbmFtZSAgPSBgcGhyYXNlXyR7cm93LmlkfS53YXZgO1xuICAgICAgICBjb25zdCB0b29sdGlwICAgPSBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fUm93UmV1c2VUb29sdGlwIHx8ICcnO1xuICAgICAgICBjb25zdCBlc2NBdHRyICAgPSAocykgPT4gJCgnPGRpdj4nKS50ZXh0KHMpLmh0bWwoKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7Jyk7XG4gICAgICAgIHJldHVybiBgPHRyIGNsYXNzPVwiZmlsZS1yb3dcIiBpZD1cInBocmFzZS1yb3ctJHtyb3cuaWR9XCJcbiAgICAgICAgICAgICAgICAgICAgZGF0YS12YWx1ZT1cIiR7cGxheVVybH1cIlxuICAgICAgICAgICAgICAgICAgICBkYXRhLXRleHQ9XCIke2VzY0F0dHIoZnVsbFRleHQpfVwiXG4gICAgICAgICAgICAgICAgICAgIGRhdGEtdm9pY2U9XCIke2VzY0F0dHIodm9pY2VJZCl9XCI+XG4gICAgICAgICAgICA8dGQ+JHskKCc8ZGl2PicpLnRleHQoY3JlYXRlZCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQgY2xhc3M9XCJwaHJhc2UtcmV1c2VcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyXCIgdGl0bGU9XCIke2VzY0F0dHIodG9vbHRpcCl9XCI+XG4gICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJmaWxlIGF1ZGlvIG91dGxpbmUgaWNvblwiPjwvaT4keyQoJzxkaXY+JykudGV4dChzaG9ydFRleHQpLmh0bWwoKX1cbiAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICA8dGQ+JHskKCc8ZGl2PicpLnRleHQodm9pY2VJZCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQgY2xhc3M9XCJzaXggd2lkZSBjZHItcGxheWVyIGhpZGUtb24tbW9iaWxlXCI+XG4gICAgICAgICAgICAgICAgPHRhYmxlPlxuICAgICAgICAgICAgICAgICAgICA8dHI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3M9XCJvbmUgd2lkZVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJ1aSB0aW55IGJhc2ljIGljb24gYnV0dG9uIHBsYXktYnV0dG9uXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpIGNsYXNzPVwidWkgaWNvbiBwbGF5XCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxhdWRpbyBwcmVsb2FkPVwibm9uZVwiIGlkPVwiYXVkaW8tcGxheWVyLXBocmFzZS1yb3ctJHtyb3cuaWR9XCIgZGF0YS1zcmM9XCIke3BsYXlVcmx9XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxzb3VyY2Ugc3JjPVwiXCIvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYXVkaW8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ1aSByYW5nZSBjZHItcGxheWVyXCI+PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj48c3BhbiBjbGFzcz1cImNkci1kdXJhdGlvblwiPjwvc3Bhbj48L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbiBkb3dubG9hZC1idXR0b25cIiBkYXRhLXZhbHVlPVwiJHtkbFVybH0/ZmlsZW5hbWU9JHtmaWxlbmFtZX1cIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJ1aSBpY29uIGRvd25sb2FkXCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgIDx0ZCBjbGFzcz1cImNvbGxhcHNpbmdcIj5cbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbnMgYWN0aW9uLWJ1dHRvbnNcIj5cbiAgICAgICAgICAgICAgICAgICAgPGEgaHJlZj1cIiNcIiBkYXRhLXZhbHVlPVwiJHtyb3cuaWR9XCJcbiAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ1aSBidXR0b24gZGVsZXRlIHR3by1zdGVwcy1kZWxldGUgcG9wdXBlZFwiXG4gICAgICAgICAgICAgICAgICAgICAgIGRhdGEtY29udGVudD1cIiR7ZXNjQXR0cihnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fSGlzdG9yeURlbGV0ZSl9XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aSBjbGFzcz1cImljb24gdHJhc2ggcmVkXCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICA8L2E+XG4gICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICA8L3RkPlxuICAgICAgICA8L3RyPmA7XG4gICAgfSxcbn07XG5cbiQoZG9jdW1lbnQpLnJlYWR5KCgpID0+IHtcbiAgICBwaHJhc2VTdHVkaW9JbmRleC5pbml0aWFsaXplKCk7XG59KTtcbiJdfQ==