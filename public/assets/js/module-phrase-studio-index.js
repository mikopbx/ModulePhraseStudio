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
      // Once the binary is on disk we offer "Update engine" instead of
      // an Uninstall — re-running install() overwrites the tarball with
      // the pinned RELEASE_VERSION (or whatever the catalog now points
      // at), so the same button doubles as a refresh path. Removing the
      // Uninstall button from the UI is intentional: users wanted a
      // refresh, not a wipe; full removal still works via DELETE /engine
      // for anyone scripting against the API.
      $box.append($('<div>').addClass('ui positive message').append($('<div>').addClass('header').text(globalTranslate.module_phrase_studio_EngineInstalled)).append($('<p>').text("".concat(globalTranslate.module_phrase_studio_EngineVersion, ": ").concat(data.version || '—'))).append($('<button>').addClass('ui small basic button').text(globalTranslate.module_phrase_studio_EngineUpdate) // Update path posts {force: true} so the action
      // bypasses its `isInstalled()` shortcut and actually
      // re-downloads the pinned RELEASE_VERSION. Without
      // the flag the click would be a no-op once the
      // engine is already on disk.
      .on('click', phraseStudioIndex.onEngineUpdate)));
    } else {
      $box.append($('<div>').addClass('ui warning message').append($('<div>').addClass('header').text(globalTranslate.module_phrase_studio_EngineNotInstalled)).append($('<p>').text(globalTranslate.module_phrase_studio_EngineInstallHint)).append($('<button>').addClass('ui primary button').text(globalTranslate.module_phrase_studio_EngineInstall).on('click', phraseStudioIndex.onEngineInstall)));
    }
  },
  onEngineInstall: function onEngineInstall() {
    phraseStudioIndex.dispatchEngineInstall($(this), false);
  },
  onEngineUpdate: function onEngineUpdate() {
    phraseStudioIndex.dispatchEngineInstall($(this), true);
  },
  dispatchEngineInstall: function dispatchEngineInstall($btn, force) {
    $btn.addClass('loading disabled');
    $.ajax({
      url: phraseStudioIndex.api.engineInstall,
      method: 'POST',
      // POST body is required for `force` to land on the action's
      // $data array; the action runs `filter_var(..., FILTER_VALIDATE_BOOLEAN)`
      // so the JSON literal `true` arrives as PHP true, not "1".
      data: JSON.stringify({
        force: !!force
      }),
      contentType: 'application/json',
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

  /** Stash for the most recent history payload so we can re-render it
   *  once the voices catalogue arrives (race-fix: refreshVoices and
   *  refreshHistory fire in parallel on init; when history wins first
   *  the rows render with raw voice_ids until voices catch up).
   */
  lastHistoryRows: [],
  refreshVoices: function refreshVoices() {
    $.ajax({
      url: phraseStudioIndex.api.voices,
      method: 'GET',
      dataType: 'json'
    }).done(function (response) {
      phraseStudioIndex.state.voices = response && response.data || [];
      phraseStudioIndex.renderVoicesTable();
      phraseStudioIndex.renderVoicePicker(); // If history already painted with raw voice_ids (parallel init
      // race), repaint now that we have the catalogue for flag lookup.

      if (phraseStudioIndex.lastHistoryRows.length > 0) {
        phraseStudioIndex.renderHistory(phraseStudioIndex.lastHistoryRows);
      }
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
      var rows = response && response.data || [];
      phraseStudioIndex.lastHistoryRows = rows;
      phraseStudioIndex.renderHistory(rows);

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

  /**
   * Resolves a phrase row's voice_id into a "🇷🇺 Irina (medium)" string with
   * the matching Semantic UI flag. Falls back to the raw voice_id when the
   * voice is not in the loaded catalogue (e.g. user removed the voice but
   * the phrase row from before is still in history).
   */
  formatVoiceLabel: function formatVoiceLabel(voiceId) {
    var escAttr = function escAttr(s) {
      return $('<div>').text(s).html().replace(/"/g, '&quot;');
    };

    if (!voiceId) return '<span class="ui label">—</span>';
    var voice = phraseStudioIndex.state.voices.find(function (v) {
      return v.voice_id === voiceId;
    });

    if (!voice) {
      // Voice no longer installed — keep raw id so the user can
      // identify which historic phrase used what model.
      return $('<div>').text(voiceId).html();
    }

    var flag = phraseStudioIndex.flagClassFor(voice.language);
    var flagHtml = flag ? "<i class=\"".concat(flag, " flag\" title=\"").concat(escAttr(voice.language_label), "\"></i>") : '';
    var label = "".concat(voice.voice_name, " (").concat(voice.quality, ")");
    return "".concat(flagHtml).concat($('<div>').text(label).html());
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

    return "<tr class=\"file-row\" id=\"phrase-row-".concat(row.id, "\"\n                    data-value=\"").concat(playUrl, "\"\n                    data-text=\"").concat(escAttr(fullText), "\"\n                    data-voice=\"").concat(escAttr(voiceId), "\">\n            <td>").concat($('<div>').text(created).html(), "</td>\n            <td class=\"phrase-reuse\" style=\"cursor:pointer\" title=\"").concat(escAttr(tooltip), "\">\n                <i class=\"file audio outline icon\"></i>").concat($('<div>').text(shortText).html(), "\n            </td>\n            <td>").concat(phraseStudioIndex.formatVoiceLabel(voiceId), "</td>\n            <td class=\"six wide cdr-player hide-on-mobile\">\n                <table>\n                    <tr>\n                        <td class=\"one wide\">\n                            <button class=\"ui tiny basic icon button play-button\">\n                                <i class=\"ui icon play\"></i>\n                            </button>\n                            <audio preload=\"none\" id=\"audio-player-phrase-row-").concat(row.id, "\" data-src=\"").concat(playUrl, "\">\n                                <source src=\"\"/>\n                            </audio>\n                        </td>\n                        <td>\n                            <div class=\"ui range cdr-player\"></div>\n                        </td>\n                        <td class=\"one wide\"><span class=\"cdr-duration\"></span></td>\n                        <td class=\"one wide\">\n                            <button class=\"ui tiny basic icon button download-button\" data-value=\"").concat(dlUrl, "?filename=").concat(filename, "\">\n                                <i class=\"ui icon download\"></i>\n                            </button>\n                        </td>\n                    </tr>\n                </table>\n            </td>\n            <td class=\"collapsing\">\n                <div class=\"ui tiny basic icon buttons action-buttons\">\n                    <a href=\"#\" data-value=\"").concat(row.id, "\"\n                       class=\"ui button delete two-steps-delete popuped\"\n                       data-content=\"").concat(escAttr(globalTranslate.module_phrase_studio_HistoryDelete), "\">\n                        <i class=\"icon trash red\"></i>\n                    </a>\n                </div>\n            </td>\n        </tr>");
  }
};
$(document).ready(function () {
  phraseStudioIndex.initialize();
});

//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNyYy9tb2R1bGUtcGhyYXNlLXN0dWRpby1pbmRleC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOztBQUFBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EsSUFBTSxpQkFBaUIsR0FBRztBQUN0QixFQUFBLEdBQUcsRUFBRTtBQUNELElBQUEsTUFBTSxFQUFTLDZDQURkO0FBRUQsSUFBQSxhQUFhLEVBQUUscURBRmQ7QUFHRCxJQUFBLE1BQU0sRUFBUyw2Q0FIZDtBQUlELElBQUEsWUFBWSxFQUFHLHFEQUpkO0FBS0QsSUFBQSxPQUFPLEVBQVEsOENBTGQ7QUFNRCxJQUFBLFlBQVksRUFBRyxhQUFhLEdBQUc7QUFOOUIsR0FEaUI7QUFVdEIsRUFBQSxLQUFLLEVBQUU7QUFDSCxJQUFBLE1BQU0sRUFBRSxJQURMO0FBRUgsSUFBQSxNQUFNLEVBQUUsRUFGTDtBQUdILElBQUEsWUFBWSxFQUFFLEVBSFg7QUFJSCxJQUFBLGdCQUFnQixFQUFFLElBSmY7QUFLSDtBQUNBO0FBQ0E7QUFDQSxJQUFBLFlBQVksRUFBRTtBQVJYLEdBVmU7QUFxQnRCO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLEVBQUEsd0JBQXdCLEVBQUUsSUE5Qko7QUErQnRCLEVBQUEseUJBQXlCLEVBQUUsR0EvQkw7QUFpQ3RCLEVBQUEsVUFqQ3NCLHdCQWlDVDtBQUNULElBQUEsQ0FBQyxDQUFDLCtCQUFELENBQUQsQ0FBbUMsR0FBbkM7QUFDQSxJQUFBLENBQUMsQ0FBQyxrQ0FBRCxDQUFELENBQXNDLFFBQXRDO0FBQ0EsSUFBQSxDQUFDLENBQUMsNEJBQUQsQ0FBRCxDQUFnQyxRQUFoQyxHQUhTLENBS1Q7QUFDQTtBQUNBOztBQUNBLFFBQUksQ0FBQyxNQUFNLENBQUMsb0JBQVAsSUFBK0IsRUFBaEMsRUFBb0MsUUFBeEMsRUFBa0Q7QUFDOUMsTUFBQSxDQUFDLENBQUMseUNBQ0ksZ0NBREwsQ0FBRCxDQUN3QyxJQUR4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RUFsQzFDLG1JQW9DK0IsT0FBTyxDQUFDLGVBQWUsQ0FBQyxrQ0FBakIsQ0FwQ3RDO0FBMENIO0FBdnBCcUIsQ0FBMUI7QUEwcEJBLENBQUMsQ0FBQyxRQUFELENBQUQsQ0FBWSxLQUFaLENBQWtCLFlBQU07QUFDcEIsRUFBQSxpQkFBaUIsQ0FBQyxVQUFsQjtBQUNILENBRkQiLCJmaWxlIjoibW9kdWxlLXBocmFzZS1zdHVkaW8taW5kZXguanMiLCJzb3VyY2VzQ29udGVudCI6WyIvKiBnbG9iYWwgJCwgZ2xvYmFsUm9vdFVybCwgZ2xvYmFsVHJhbnNsYXRlLCBQYnhBcGksIFVzZXJNZXNzYWdlLCBJbmRleFNvdW5kUGxheWVyLCBUb2tlbk1hbmFnZXIsIFNlbWFudGljTG9jYWxpemF0aW9uICovXG5cbi8qKlxuICogU3R1ZGlvIHBhZ2UgY29udHJvbGxlciBmb3IgTW9kdWxlUGhyYXNlU3R1ZGlvLlxuICpcbiAqIFRoZSBwYWdlIGhhcyBmb3VyIHRhYnMgKHN0dWRpbyAvIHZvaWNlcyAvIGVuZ2luZSAvIGhpc3RvcnkpLiBBbGwgZGF0YSBmbG93c1xuICogdGhyb3VnaCB0aGUgbW9kdWxlJ3MgUkVTVCB2MyBlbmRwb2ludHMgdW5kZXIgL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvLlxuICogV2UgcmVseSBvbiBQYnhBcGkuY2FsbEpzb25SZXN0IGhlbHBlciwgd2hpY2ggYWxyZWFkeSBoYW5kbGVzIGF1dGggaGVhZGVycy5cbiAqL1xuY29uc3QgcGhyYXNlU3R1ZGlvSW5kZXggPSB7XG4gICAgYXBpOiB7XG4gICAgICAgIGVuZ2luZTogICAgICAgICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vZW5naW5lJyxcbiAgICAgICAgZW5naW5lSW5zdGFsbDogJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby9lbmdpbmU6aW5zdGFsbCcsXG4gICAgICAgIHZvaWNlczogICAgICAgICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vdm9pY2VzJyxcbiAgICAgICAgdm9pY2VJbnN0YWxsOiAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby92b2ljZXM6aW5zdGFsbCcsXG4gICAgICAgIHBocmFzZXM6ICAgICAgICcvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8vcGhyYXNlcycsXG4gICAgICAgIHNhdmVEZWZhdWx0czogIGdsb2JhbFJvb3RVcmwgKyAnbW9kdWxlLXBocmFzZS1zdHVkaW8vbW9kdWxlLXBocmFzZS1zdHVkaW8vc2F2ZScsXG4gICAgfSxcblxuICAgIHN0YXRlOiB7XG4gICAgICAgIGVuZ2luZTogbnVsbCxcbiAgICAgICAgdm9pY2VzOiBbXSxcbiAgICAgICAgc291bmRQbGF5ZXJzOiB7fSxcbiAgICAgICAgaGlzdG9yeURhdGFUYWJsZTogbnVsbCxcbiAgICAgICAgLy8gdm9pY2VfaWQg4oaSIHsgc3RhcnRlZEF0LCBhdHRlbXB0cywgdGltZXIgfSBmb3IgaW5zdGFsbHMgaW4gZmxpZ2h0LlxuICAgICAgICAvLyBUcmFja2luZyBhdHRlbXB0cyBjbGllbnQtc2lkZSBsZXRzIHVzIGNhcCBwb2xsaW5nIGF0IH4xMCBtaW51dGVzXG4gICAgICAgIC8vIGV2ZW4gaWYgdGhlIHdvcmtlciBzaWxlbnRseSBkaWVzLCBpbnN0ZWFkIG9mIHNwaW5uaW5nIGZvcmV2ZXIuXG4gICAgICAgIGluc3RhbGxQb2xsczoge30sXG4gICAgfSxcblxuICAgIC8vIFZvaWNlIGluc3RhbGwgcG9sbGluZzogMy1zZWNvbmQgdGljayDDlyA1MDAgYXR0ZW1wdHMg4omIIDI1IG1pbnV0ZXMuXG4gICAgLy8gVGhlIGRldGFjaGVkIGBpbnN0YWxsLXZvaWNlLnBocGAgcnVubmVyIHVzZXMgYGN1cmwgLS1tYXgtdGltZSA2MDBgXG4gICAgLy8gcGVyIGFzc2V0ICjDlzIgZmlsZXMgPSAyMC1taW51dGUgaGFyZCBiYWNrZW5kIGNlaWxpbmcpLiBUaGUgcG9sbCBjYXBcbiAgICAvLyBtdXN0IHNpdCBBQk9WRSB0aGF0IGNlaWxpbmcg4oCUIG90aGVyd2lzZSBhIHNsb3ctYnV0LXN0aWxsLXJ1bm5pbmdcbiAgICAvLyBkb3dubG9hZCBpcyBtaXN0YWtlbiBmb3IgYSBjcmFzaCwgdGhlIEpTIGJhaWxzLCBhbmQgdGhlIHVzZXIgaXMgbGVmdFxuICAgIC8vIHdpdGggYSBzdHVjayBVSSBldmVuIHRob3VnaCB0aGUgd29ya2VyIGlzIHN0aWxsIHdyaXRpbmcgdGhlIGZpbGUuXG4gICAgLy8gQmV5b25kIDI1IG1pbnV0ZXMgd2UgaGFuZCByZWNvdmVyeSBvZmYgdG8gdGhlIHNlcnZlci1zaWRlIHN3ZWVwZXJcbiAgICAvLyAoMzAgbWluLCBHZXRMaXN0QWN0aW9uOjpzd2VlcFN0YWxlSW5zdGFsbHMpLCB3aGljaCBmbGlwcyB0aGUgcm93IHRvXG4gICAgLy8gYGZhaWxlZGAgYW5kIHRoZSBuZXh0IHJlZnJlc2ggc2hvd3MgdGhlIHN0YW5kYXJkIFJldHJ5IGJ1dHRvbi5cbiAgICBJTlNUQUxMX1BPTExfSU5URVJWQUxfTVM6IDMwMDAsXG4gICAgSU5TVEFMTF9QT0xMX01BWF9BVFRFTVBUUzogNTAwLFxuXG4gICAgaW5pdGlhbGl6ZSgpIHtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tdGFiLW1lbnUgLml0ZW0nKS50YWIoKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tcmVtZW1iZXItY2hlY2tib3gnKS5jaGVja2JveCgpO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1zYW1wbGUtcmF0ZScpLmRyb3Bkb3duKCk7XG5cbiAgICAgICAgLy8gTW9kdWxlIGRpc2FibGVkIOKGkiBwYWdlIGlzIHJlYWQtb25seSwgc2tpcCBSRVNUIHBvbGxpbmcgYW5kXG4gICAgICAgIC8vIGRpc2FibGUgdGhlIGZvcm0gaW5wdXRzLiBBdm9pZHMgdGhlIFwiZmFpbGVkIHRvIGxvYWQgdm9pY2VzXCJcbiAgICAgICAgLy8gZXJyb3IgcG9wdXAgdXNlcnMgZ290IHdoZW4gb3BlbmluZyBhIGRpc2FibGVkIG1vZHVsZSdzIHBhZ2UuXG4gICAgICAgIGlmICgod2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzIHx8IHt9KS5kaXNhYmxlZCkge1xuICAgICAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtZm9ybSA6aW5wdXQsJ1xuICAgICAgICAgICAgICAgICsgJyNwaHJhc2Utc3R1ZGlvLWdlbmVyYXRlLWJ1dHRvbicpLnByb3AoJ2Rpc2FibGVkJywgdHJ1ZSk7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cblxuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0Jykub24oJ2lucHV0JywgcGhyYXNlU3R1ZGlvSW5kZXgudXBkYXRlQ291bnRlcik7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWdlbmVyYXRlLWJ1dHRvbicpLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uR2VuZXJhdGUpO1xuICAgICAgICAkKCdbZGF0YS10YWI9XCJ2b2ljZXNcIl0nKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoVm9pY2VzKTtcbiAgICAgICAgJCgnW2RhdGEtdGFiPVwiZW5naW5lXCJdJykub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEVuZ2luZSk7XG4gICAgICAgICQoJ1tkYXRhLXRhYj1cImhpc3RvcnlcIl0nKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoSGlzdG9yeSk7XG5cbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguYXBwbHlEZWZhdWx0cygpO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKCk7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMoKTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKTtcbiAgICB9LFxuXG4gICAgYXBwbHlEZWZhdWx0cygpIHtcbiAgICAgICAgY29uc3QgZCA9IHdpbmRvdy5waHJhc2VTdHVkaW9EZWZhdWx0cyB8fCB7fTtcbiAgICAgICAgaWYgKGQuc2FtcGxlUmF0ZSkge1xuICAgICAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tc2FtcGxlLXJhdGUnKS5kcm9wZG93bignc2V0IHNlbGVjdGVkJywgZC5zYW1wbGVSYXRlKTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGVDb3VudGVyKCkge1xuICAgICAgICBjb25zdCB2YWx1ZSA9ICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS52YWwoKSB8fCAnJztcbiAgICAgICAgY29uc3QgbWF4ICAgPSBwYXJzZUludCgkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykuYXR0cignbWF4bGVuZ3RoJykgfHwgJzgwMCcsIDEwKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tdGV4dC1jb3VudGVyJykudGV4dChgJHt2YWx1ZS5sZW5ndGh9IC8gJHttYXh9YCk7XG4gICAgfSxcblxuICAgIHJlZnJlc2hFbmdpbmUoKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5lbmdpbmUsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmVuZ2luZSA9IChyZXNwb25zZSAmJiByZXNwb25zZS5kYXRhKSB8fCBudWxsO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVyRW5naW5lKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckVuZ2luZVN0YXR1cyk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZW5kZXJFbmdpbmUoKSB7XG4gICAgICAgIGNvbnN0ICRib3ggPSAkKCcjcGhyYXNlLXN0dWRpby1lbmdpbmUtc3RhdHVzJykuZW1wdHkoKTtcbiAgICAgICAgY29uc3QgZGF0YSA9IHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmVuZ2luZSB8fCB7fTtcbiAgICAgICAgaWYgKGRhdGEuaW5zdGFsbGVkKSB7XG4gICAgICAgICAgICAvLyBPbmNlIHRoZSBiaW5hcnkgaXMgb24gZGlzayB3ZSBvZmZlciBcIlVwZGF0ZSBlbmdpbmVcIiBpbnN0ZWFkIG9mXG4gICAgICAgICAgICAvLyBhbiBVbmluc3RhbGwg4oCUIHJlLXJ1bm5pbmcgaW5zdGFsbCgpIG92ZXJ3cml0ZXMgdGhlIHRhcmJhbGwgd2l0aFxuICAgICAgICAgICAgLy8gdGhlIHBpbm5lZCBSRUxFQVNFX1ZFUlNJT04gKG9yIHdoYXRldmVyIHRoZSBjYXRhbG9nIG5vdyBwb2ludHNcbiAgICAgICAgICAgIC8vIGF0KSwgc28gdGhlIHNhbWUgYnV0dG9uIGRvdWJsZXMgYXMgYSByZWZyZXNoIHBhdGguIFJlbW92aW5nIHRoZVxuICAgICAgICAgICAgLy8gVW5pbnN0YWxsIGJ1dHRvbiBmcm9tIHRoZSBVSSBpcyBpbnRlbnRpb25hbDogdXNlcnMgd2FudGVkIGFcbiAgICAgICAgICAgIC8vIHJlZnJlc2gsIG5vdCBhIHdpcGU7IGZ1bGwgcmVtb3ZhbCBzdGlsbCB3b3JrcyB2aWEgREVMRVRFIC9lbmdpbmVcbiAgICAgICAgICAgIC8vIGZvciBhbnlvbmUgc2NyaXB0aW5nIGFnYWluc3QgdGhlIEFQSS5cbiAgICAgICAgICAgICRib3guYXBwZW5kKFxuICAgICAgICAgICAgICAgICQoJzxkaXY+JykuYWRkQ2xhc3MoJ3VpIHBvc2l0aXZlIG1lc3NhZ2UnKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCQoJzxkaXY+JykuYWRkQ2xhc3MoJ2hlYWRlcicpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZUluc3RhbGxlZCkpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJCgnPHA+JykudGV4dChgJHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lVmVyc2lvbn06ICR7ZGF0YS52ZXJzaW9uIHx8ICfigJQnfWApKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKFxuICAgICAgICAgICAgICAgICAgICAgICAgJCgnPGJ1dHRvbj4nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5hZGRDbGFzcygndWkgc21hbGwgYmFzaWMgYnV0dG9uJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lVXBkYXRlKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBwYXRoIHBvc3RzIHtmb3JjZTogdHJ1ZX0gc28gdGhlIGFjdGlvblxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGJ5cGFzc2VzIGl0cyBgaXNJbnN0YWxsZWQoKWAgc2hvcnRjdXQgYW5kIGFjdHVhbGx5XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gcmUtZG93bmxvYWRzIHRoZSBwaW5uZWQgUkVMRUFTRV9WRVJTSU9OLiBXaXRob3V0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gdGhlIGZsYWcgdGhlIGNsaWNrIHdvdWxkIGJlIGEgbm8tb3Agb25jZSB0aGVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyBlbmdpbmUgaXMgYWxyZWFkeSBvbiBkaXNrLlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5vbkVuZ2luZVVwZGF0ZSlcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICRib3guYXBwZW5kKFxuICAgICAgICAgICAgICAgICQoJzxkaXY+JykuYWRkQ2xhc3MoJ3VpIHdhcm5pbmcgbWVzc2FnZScpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJCgnPGRpdj4nKS5hZGRDbGFzcygnaGVhZGVyJykudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lTm90SW5zdGFsbGVkKSlcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgkKCc8cD4nKS50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVJbnN0YWxsSGludCkpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLmFkZENsYXNzKCd1aSBwcmltYXJ5IGJ1dHRvbicpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZUluc3RhbGwpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uRW5naW5lSW5zdGFsbClcbiAgICAgICAgICAgICAgICAgICAgKVxuICAgICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBvbkVuZ2luZUluc3RhbGwoKSB7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LmRpc3BhdGNoRW5naW5lSW5zdGFsbCgkKHRoaXMpLCBmYWxzZSk7XG4gICAgfSxcblxuICAgIG9uRW5naW5lVXBkYXRlKCkge1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5kaXNwYXRjaEVuZ2luZUluc3RhbGwoJCh0aGlzKSwgdHJ1ZSk7XG4gICAgfSxcblxuICAgIGRpc3BhdGNoRW5naW5lSW5zdGFsbCgkYnRuLCBmb3JjZSkge1xuICAgICAgICAkYnRuLmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5lbmdpbmVJbnN0YWxsLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICAvLyBQT1NUIGJvZHkgaXMgcmVxdWlyZWQgZm9yIGBmb3JjZWAgdG8gbGFuZCBvbiB0aGUgYWN0aW9uJ3NcbiAgICAgICAgICAgIC8vICRkYXRhIGFycmF5OyB0aGUgYWN0aW9uIHJ1bnMgYGZpbHRlcl92YXIoLi4uLCBGSUxURVJfVkFMSURBVEVfQk9PTEVBTilgXG4gICAgICAgICAgICAvLyBzbyB0aGUgSlNPTiBsaXRlcmFsIGB0cnVlYCBhcnJpdmVzIGFzIFBIUCB0cnVlLCBub3QgXCIxXCIuXG4gICAgICAgICAgICBkYXRhOiBKU09OLnN0cmluZ2lmeSh7Zm9yY2U6ICEhZm9yY2V9KSxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEVuZ2luZSgpO1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcocmVzcG9uc2UubWVzc2FnZXMpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgICRidG4ucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JFbmdpbmVJbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIC8qKiBTdGFzaCBmb3IgdGhlIG1vc3QgcmVjZW50IGhpc3RvcnkgcGF5bG9hZCBzbyB3ZSBjYW4gcmUtcmVuZGVyIGl0XG4gICAgICogIG9uY2UgdGhlIHZvaWNlcyBjYXRhbG9ndWUgYXJyaXZlcyAocmFjZS1maXg6IHJlZnJlc2hWb2ljZXMgYW5kXG4gICAgICogIHJlZnJlc2hIaXN0b3J5IGZpcmUgaW4gcGFyYWxsZWwgb24gaW5pdDsgd2hlbiBoaXN0b3J5IHdpbnMgZmlyc3RcbiAgICAgKiAgdGhlIHJvd3MgcmVuZGVyIHdpdGggcmF3IHZvaWNlX2lkcyB1bnRpbCB2b2ljZXMgY2F0Y2ggdXApLlxuICAgICAqL1xuICAgIGxhc3RIaXN0b3J5Um93czogW10sXG5cbiAgICByZWZyZXNoVm9pY2VzKCkge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VzLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS52b2ljZXMgPSAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSkgfHwgW107XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJWb2ljZXNUYWJsZSgpO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVyVm9pY2VQaWNrZXIoKTtcbiAgICAgICAgICAgIC8vIElmIGhpc3RvcnkgYWxyZWFkeSBwYWludGVkIHdpdGggcmF3IHZvaWNlX2lkcyAocGFyYWxsZWwgaW5pdFxuICAgICAgICAgICAgLy8gcmFjZSksIHJlcGFpbnQgbm93IHRoYXQgd2UgaGF2ZSB0aGUgY2F0YWxvZ3VlIGZvciBmbGFnIGxvb2t1cC5cbiAgICAgICAgICAgIGlmIChwaHJhc2VTdHVkaW9JbmRleC5sYXN0SGlzdG9yeVJvd3MubGVuZ3RoID4gMCkge1xuICAgICAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlbmRlckhpc3RvcnkocGhyYXNlU3R1ZGlvSW5kZXgubGFzdEhpc3RvcnlSb3dzKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VzTGlzdCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBUcmFuc2xhdGVzIGEgUGlwZXIgbGFuZ3VhZ2UgdGFnIChlLmcuICdydS1ydScsICdlbi11cycsICdwdC1icicpXG4gICAgICogaW50byBhIFNlbWFudGljIFVJIGZsYWcgY2xhc3MuIFRoZSBzZWNvbmQgc2VnbWVudCBpcyBhbHJlYWR5IGFuXG4gICAgICogSVNPIDMxNjYtMSBhbHBoYS0yIGNvdW50cnkgY29kZSBpbiB0aGUgY2F0YWxvZ3VlLCBzbyB3ZSBqdXN0XG4gICAgICogZXh0cmFjdCBhbmQgbG93ZXJjYXNlIGl0LiBVbmtub3duIHRhZ3MgZmFsbCBiYWNrIHRvIG5vIGZsYWcuXG4gICAgICovXG4gICAgZmxhZ0NsYXNzRm9yKGxhbmd1YWdlKSB7XG4gICAgICAgIGlmICghbGFuZ3VhZ2UpIHJldHVybiAnJztcbiAgICAgICAgY29uc3QgcGFydHMgPSBTdHJpbmcobGFuZ3VhZ2UpLnRvTG93ZXJDYXNlKCkuc3BsaXQoJy0nKTtcbiAgICAgICAgY29uc3QgY2MgPSBwYXJ0c1twYXJ0cy5sZW5ndGggLSAxXTtcbiAgICAgICAgaWYgKCFjYyB8fCBjYy5sZW5ndGggIT09IDIpIHJldHVybiAnJztcbiAgICAgICAgcmV0dXJuIGNjO1xuICAgIH0sXG5cbiAgICByZW5kZXJWb2ljZXNUYWJsZSgpIHtcbiAgICAgICAgY29uc3QgJHRib2R5ID0gJCgnI3BocmFzZS1zdHVkaW8tdm9pY2VzLXRhYmxlIHRib2R5JykuZW1wdHkoKTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzLmZvckVhY2goKHZvaWNlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCAkcm93ID0gJCgnPHRyPicpLmF0dHIoJ2RhdGEtdm9pY2UnLCB2b2ljZS52b2ljZV9pZCk7XG4gICAgICAgICAgICBjb25zdCBmbGFnID0gcGhyYXNlU3R1ZGlvSW5kZXguZmxhZ0NsYXNzRm9yKHZvaWNlLmxhbmd1YWdlKTtcbiAgICAgICAgICAgIGNvbnN0ICRsYW5nID0gJCgnPHRkPicpO1xuICAgICAgICAgICAgaWYgKGZsYWcpIHtcbiAgICAgICAgICAgICAgICAkbGFuZy5hcHBlbmQoYDxpIGNsYXNzPVwiJHtmbGFnfSBmbGFnXCI+PC9pPmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJGxhbmcuYXBwZW5kKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGAke3ZvaWNlLmxhbmd1YWdlX2xhYmVsfSAoJHt2b2ljZS5sYW5ndWFnZX0pYCkpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJGxhbmcpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQodm9pY2Uudm9pY2VfbmFtZSkpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQodm9pY2UucXVhbGl0eSkpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQoYCR7dm9pY2Uuc2FtcGxlX3JhdGV9IEh6YCkpO1xuXG4gICAgICAgICAgICBjb25zdCBzdGF0dXMgPSB2b2ljZS5pbnN0YWxsX3N0YXR1cyB8fCAodm9pY2UuaW5zdGFsbGVkID8gJ2luc3RhbGxlZCcgOiAnJyk7XG4gICAgICAgICAgICBjb25zdCAkc3RhdHVzQ2VsbCA9ICQoJzx0ZD4nKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgPT09ICdpbnN0YWxsZWQnKSB7XG4gICAgICAgICAgICAgICAgJHN0YXR1c0NlbGwuaHRtbChgPHNwYW4gY2xhc3M9XCJ1aSBncmVlbiBsYWJlbFwiPiR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbGVkfTwvc3Bhbj5gKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdHVzID09PSAnaW5zdGFsbGluZycpIHtcbiAgICAgICAgICAgICAgICAkc3RhdHVzQ2VsbC5odG1sKFxuICAgICAgICAgICAgICAgICAgICAnPGRpdiBjbGFzcz1cInVpIGFjdGl2ZSBpbmxpbmUgbWluaSBsb2FkZXJcIj48L2Rpdj4gJ1xuICAgICAgICAgICAgICAgICAgICArIGA8c3BhbiBjbGFzcz1cInVpIHllbGxvdyBsYWJlbFwiPiR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbGluZ308L3NwYW4+YFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHN0YXR1cyA9PT0gJ2ZhaWxlZCcpIHtcbiAgICAgICAgICAgICAgICBjb25zdCBlcnIgPSB2b2ljZS5pbnN0YWxsX2Vycm9yIHx8ICcnO1xuICAgICAgICAgICAgICAgICRzdGF0dXNDZWxsLmh0bWwoXG4gICAgICAgICAgICAgICAgICAgIGA8c3BhbiBjbGFzcz1cInVpIHJlZCBsYWJlbFwiIHRpdGxlPVwiJHskKCc8ZGl2PicpLnRleHQoZXJyKS5odG1sKCl9XCI+YFxuICAgICAgICAgICAgICAgICAgICArIGAke2dsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZUZhaWxlZH08L3NwYW4+YFxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICRzdGF0dXNDZWxsLmh0bWwoYDxzcGFuIGNsYXNzPVwidWkgbGFiZWxcIj4ke2dsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZU5vdEluc3RhbGxlZH08L3NwYW4+YCk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkcm93LmFwcGVuZCgkc3RhdHVzQ2VsbCk7XG5cbiAgICAgICAgICAgIGNvbnN0ICRhY3Rpb25zID0gJCgnPHRkPicpLmFkZENsYXNzKCdyaWdodCBhbGlnbmVkJyk7XG4gICAgICAgICAgICBpZiAoc3RhdHVzID09PSAnaW5zdGFsbGVkJykge1xuICAgICAgICAgICAgICAgICRhY3Rpb25zLmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgJCgnPGJ1dHRvbj4nKS5hZGRDbGFzcygndWkgc21hbGwgYmFzaWMgcmVkIGljb24gYnV0dG9uJylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCdkYXRhLXZvaWNlJywgdm9pY2Uudm9pY2VfaWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cigndGl0bGUnLCBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VEZWxldGUpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCc8aSBjbGFzcz1cInRyYXNoIGljb25cIj48L2k+JylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5vblZvaWNlVW5pbnN0YWxsKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGVsc2UgaWYgKHN0YXR1cyA9PT0gJ2luc3RhbGxpbmcnKSB7XG4gICAgICAgICAgICAgICAgLy8gV2hpbGUgdGhlIHdvcmtlciBpcyBkb3dubG9hZGluZyB3ZSBsb2NrIHRoZSBhY3Rpb24gY2VsbCDigJRcbiAgICAgICAgICAgICAgICAvLyBzaG93aW5nIGEgZGlzYWJsZWQgc3Bpbm5lciBtYWtlcyB0aGUgaW4tZmxpZ2h0IHN0YXRlIHJlYWRcbiAgICAgICAgICAgICAgICAvLyBjbGVhcmx5IGFuZCBwcmV2ZW50cyBkb3VibGUtcHVibGlzaCBvbiBpbXBhdGllbnQgY2xpY2tzLlxuICAgICAgICAgICAgICAgICRhY3Rpb25zLmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgJCgnPGJ1dHRvbj4nKS5hZGRDbGFzcygndWkgc21hbGwgcHJpbWFyeSBpY29uIGJ1dHRvbiBsb2FkaW5nIGRpc2FibGVkJylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCdkYXRhLXZvaWNlJywgdm9pY2Uudm9pY2VfaWQpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cigndGl0bGUnLCBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VJbnN0YWxsaW5nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgnPGkgY2xhc3M9XCJkb3dubG9hZCBpY29uXCI+PC9pPicpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgLy8gJ2ZhaWxlZCcgYW5kIG5vdC1pbnN0YWxsZWQgc2hhcmUgdGhlIHNhbWUgYWN0aW9uIGJ1dHRvbiDigJRcbiAgICAgICAgICAgICAgICAvLyBib3RoIHJlc3VsdCBpbiBwdWJsaXNoaW5nIGEgZnJlc2ggaW5zdGFsbF92b2ljZSBqb2IuXG4gICAgICAgICAgICAgICAgY29uc3QgbGFiZWwgPSBzdGF0dXMgPT09ICdmYWlsZWQnXG4gICAgICAgICAgICAgICAgICAgID8gZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlUmV0cnlcbiAgICAgICAgICAgICAgICAgICAgOiBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VJbnN0YWxsO1xuICAgICAgICAgICAgICAgICRhY3Rpb25zLmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgJCgnPGJ1dHRvbj4nKS5hZGRDbGFzcygndWkgc21hbGwgcHJpbWFyeSBpY29uIGJ1dHRvbicpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cignZGF0YS12b2ljZScsIHZvaWNlLnZvaWNlX2lkKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ3RpdGxlJywgbGFiZWwpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCc8aSBjbGFzcz1cImRvd25sb2FkIGljb25cIj48L2k+JylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5vblZvaWNlSW5zdGFsbClcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJGFjdGlvbnMpO1xuICAgICAgICAgICAgJHRib2R5LmFwcGVuZCgkcm93KTtcbiAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gUmUtYXJtIHBvbGxpbmcgZm9yIGFueSB2b2ljZSB0aGUgc2VydmVyIHN0aWxsIHJlcG9ydHMgYXNcbiAgICAgICAgLy8gJ2luc3RhbGxpbmcnIChjb3ZlcnMgcGFnZSByZWxvYWRzIG1pZC1pbnN0YWxsKS5cbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzXG4gICAgICAgICAgICAuZmlsdGVyKCh2KSA9PiB2Lmluc3RhbGxfc3RhdHVzID09PSAnaW5zdGFsbGluZycpXG4gICAgICAgICAgICAuZm9yRWFjaCgodikgPT4gcGhyYXNlU3R1ZGlvSW5kZXguc2NoZWR1bGVJbnN0YWxsUG9sbCh2LnZvaWNlX2lkKSk7XG4gICAgfSxcblxuICAgIHJlbmRlclZvaWNlUGlja2VyKCkge1xuICAgICAgICBjb25zdCAkc2VsZWN0ID0gJCgnI3BocmFzZS1zdHVkaW8tdm9pY2UnKTtcbiAgICAgICAgY29uc3QgcHJldmlvdXMgPSAkc2VsZWN0LnZhbCgpO1xuICAgICAgICBjb25zdCBmYWxsYmFjayA9ICh3aW5kb3cucGhyYXNlU3R1ZGlvRGVmYXVsdHMgfHwge30pLnZvaWNlIHx8ICcnO1xuICAgICAgICAkc2VsZWN0LmVtcHR5KCk7XG4gICAgICAgIGNvbnN0IGluc3RhbGxlZCA9IHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnZvaWNlcy5maWx0ZXIoKHYpID0+IHYuaW5zdGFsbGVkKTtcbiAgICAgICAgaWYgKGluc3RhbGxlZC5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICRzZWxlY3QuYXBwZW5kKCQoJzxvcHRpb24+JykudmFsKCcnKS50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19QaWNrZXJFbXB0eSkpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgaW5zdGFsbGVkLmZvckVhY2goKHZvaWNlKSA9PiB7XG4gICAgICAgICAgICAgICAgY29uc3QgZmxhZyA9IHBocmFzZVN0dWRpb0luZGV4LmZsYWdDbGFzc0Zvcih2b2ljZS5sYW5ndWFnZSk7XG4gICAgICAgICAgICAgICAgLy8gU2VtYW50aWMgVUkgZHJvcGRvd24gcmVhZHMgYGRhdGEtdGV4dGAgZm9yIHRoZSBkaXNwbGF5IHN0cmluZ1xuICAgICAgICAgICAgICAgIC8vIGFuZCByZW5kZXJzIGEgZmxhZyBmcm9tIGBkYXRhLWZsYWdgIHdoZW4gcHJlc2VudCwgc28gdGhlIGNob3NlblxuICAgICAgICAgICAgICAgIC8vIG9wdGlvbiBrZWVwcyB0aGUgaWNvbiBhZnRlciBzZWxlY3Rpb24uXG4gICAgICAgICAgICAgICAgY29uc3QgJG9wdCA9ICQoJzxvcHRpb24+JylcbiAgICAgICAgICAgICAgICAgICAgLnZhbCh2b2ljZS52b2ljZV9pZClcbiAgICAgICAgICAgICAgICAgICAgLnRleHQoYCR7dm9pY2UubGFuZ3VhZ2VfbGFiZWx9IOKAlCAke3ZvaWNlLnZvaWNlX25hbWV9ICgke3ZvaWNlLnF1YWxpdHl9KWApO1xuICAgICAgICAgICAgICAgIGlmIChmbGFnKSB7XG4gICAgICAgICAgICAgICAgICAgICRvcHQuYXR0cignZGF0YS1mbGFnJywgZmxhZyk7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICRzZWxlY3QuYXBwZW5kKCRvcHQpO1xuICAgICAgICAgICAgfSk7XG4gICAgICAgIH1cbiAgICAgICAgJHNlbGVjdC5kcm9wZG93bih7ZnVsbFRleHRTZWFyY2g6IHRydWV9KTtcbiAgICAgICAgY29uc3Qgd2FudCA9IHByZXZpb3VzIHx8IGZhbGxiYWNrO1xuICAgICAgICBpZiAod2FudCkge1xuICAgICAgICAgICAgJHNlbGVjdC5kcm9wZG93bignc2V0IHNlbGVjdGVkJywgd2FudCk7XG4gICAgICAgIH1cbiAgICB9LFxuXG4gICAgb25Wb2ljZUluc3RhbGwoKSB7XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKHRoaXMpO1xuICAgICAgICBjb25zdCB2b2ljZUlkID0gJGJ0bi5kYXRhKCd2b2ljZScpO1xuICAgICAgICAvLyBMb2NrIHRoZSBidXR0b24gaW1tZWRpYXRlbHkgc28gaW1wYXRpZW50IGRvdWJsZS1jbGlja3MgY2FuJ3QgcXVldWVcbiAgICAgICAgLy8gYSBkdXBsaWNhdGUgaW5zdGFsbC4gVGhlIGJ1dHRvbiBzdGF5cyBkaXNhYmxlZCB1bnRpbCByZWZyZXNoVm9pY2VzXG4gICAgICAgIC8vIHJlLXJlbmRlcnMgdGhlIHJvdyBmcm9tIHRoZSBuZXcgaW5zdGFsbF9zdGF0dXMuXG4gICAgICAgICRidG4uYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLnZvaWNlSW5zdGFsbCxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoe3ZvaWNlX2lkOiB2b2ljZUlkfSksXG4gICAgICAgICAgICBjb250ZW50VHlwZTogJ2FwcGxpY2F0aW9uL2pzb24nLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIGlmIChyZXNwb25zZSAmJiByZXNwb25zZS5yZXN1bHQgPT09IGZhbHNlKSB7XG4gICAgICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhyZXNwb25zZS5tZXNzYWdlc1xuICAgICAgICAgICAgICAgICAgICB8fCBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZUluc3RhbGwpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIEJhY2tlbmQgcmV0dXJucyAyMDIgd2l0aCBpbnN0YWxsX3N0YXR1cz0naW5zdGFsbGluZycgYmVmb3JlIHRoZVxuICAgICAgICAgICAgLy8gd29ya2VyIGFjdHVhbGx5IHJ1bnMgY3VybC4gVGhlIHJvdyBzcGlubmVyICsgXCJEb3dubG9hZGluZ+KAplwiIGxhYmVsXG4gICAgICAgICAgICAvLyBhbmQgdGhlIGRpc2FibGVkIGFjdGlvbiBidXR0b24gYWxyZWFkeSBjb252ZXkgdGhlIGluLWZsaWdodCBzdGF0ZVxuICAgICAgICAgICAgLy8g4oCUIG5vIHRvYXN0IG5lZWRlZC5cbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMoKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnNjaGVkdWxlSW5zdGFsbFBvbGwodm9pY2VJZCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvclZvaWNlSW5zdGFsbCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBQb2xscyBHRVQgL3ZvaWNlcyBmb3IgdGhlIGdpdmVuIHZvaWNlX2lkIHVudGlsIGluc3RhbGxfc3RhdHVzIGZsaXBzXG4gICAgICogb3V0IG9mICdpbnN0YWxsaW5nJy4gUmUtZW50cmFudDogc2NoZWR1bGluZyB0aGUgc2FtZSB2b2ljZSB3aGlsZSBhXG4gICAgICogdGltZXIgaXMgYWxyZWFkeSBwZW5kaW5nIGlzIGEgbm8tb3AgKGNvdmVycyBkb3VibGUtcmVuZGVycyB0cmlnZ2VyZWRcbiAgICAgKiBieSB0YWIgc3dpdGNoZXMgYW5kIGNvbmN1cnJlbnQgcmVmcmVzaFZvaWNlcyBjYWxscykuXG4gICAgICovXG4gICAgc2NoZWR1bGVJbnN0YWxsUG9sbCh2b2ljZUlkKSB7XG4gICAgICAgIGNvbnN0IHBvbGxzID0gcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaW5zdGFsbFBvbGxzO1xuICAgICAgICBpZiAocG9sbHNbdm9pY2VJZF0pIHJldHVybjtcbiAgICAgICAgcG9sbHNbdm9pY2VJZF0gPSB7c3RhcnRlZEF0OiBEYXRlLm5vdygpLCBhdHRlbXB0czogMH07XG4gICAgICAgIHBvbGxzW3ZvaWNlSWRdLnRpbWVyID0gc2V0SW50ZXJ2YWwoXG4gICAgICAgICAgICAoKSA9PiBwaHJhc2VTdHVkaW9JbmRleC50aWNrSW5zdGFsbFBvbGwodm9pY2VJZCksXG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5JTlNUQUxMX1BPTExfSU5URVJWQUxfTVNcbiAgICAgICAgKTtcbiAgICB9LFxuXG4gICAgY2FuY2VsSW5zdGFsbFBvbGwodm9pY2VJZCkge1xuICAgICAgICBjb25zdCBlbnRyeSA9IHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmluc3RhbGxQb2xsc1t2b2ljZUlkXTtcbiAgICAgICAgaWYgKCFlbnRyeSkgcmV0dXJuO1xuICAgICAgICBjbGVhckludGVydmFsKGVudHJ5LnRpbWVyKTtcbiAgICAgICAgZGVsZXRlIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmluc3RhbGxQb2xsc1t2b2ljZUlkXTtcbiAgICB9LFxuXG4gICAgdGlja0luc3RhbGxQb2xsKHZvaWNlSWQpIHtcbiAgICAgICAgY29uc3QgZW50cnkgPSBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5pbnN0YWxsUG9sbHNbdm9pY2VJZF07XG4gICAgICAgIGlmICghZW50cnkpIHJldHVybjtcbiAgICAgICAgZW50cnkuYXR0ZW1wdHMgKz0gMTtcbiAgICAgICAgaWYgKGVudHJ5LmF0dGVtcHRzID4gcGhyYXNlU3R1ZGlvSW5kZXguSU5TVEFMTF9QT0xMX01BWF9BVFRFTVBUUykge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguY2FuY2VsSW5zdGFsbFBvbGwodm9pY2VJZCk7XG4gICAgICAgICAgICAvLyBXZSBkZWxpYmVyYXRlbHkgZG8gTk9UIERFTEVURSB0aGUgcm93IGhlcmU6IHRoZSBjYXAgaXMgc2V0XG4gICAgICAgICAgICAvLyBhYm92ZSB0aGUgYmFja2VuZCdzIHdvcnN0LWNhc2UgY3VybCB3aW5kb3csIGJ1dCBhIGdlbnVpbmVseVxuICAgICAgICAgICAgLy8gc2xvdyBpbnN0YWxsIGNhbiBzdGlsbCBiZSB3cml0aW5nIGZpbGVzLiBZYW5raW5nIHRoZSByb3dcbiAgICAgICAgICAgIC8vIHdvdWxkIHJhY2Ugd2l0aCB0aGUgd29ya2VyJ3MgZmluYWwgc2F2ZSAob3JwaGFuIC5vbm54KSBhbmRcbiAgICAgICAgICAgIC8vIGVyYXNlIGEgcmVhbCBzdWNjZXNzIGEgZmV3IHNlY29uZHMgYmVmb3JlIGl0IGxhbmRzLiBKdXN0XG4gICAgICAgICAgICAvLyBzdXJmYWNlIGEgaGludCBhbmQgbGV0IHRoZSBzZXJ2ZXItc2lkZSBzd2VlcGVyICgzMCBtaW4sXG4gICAgICAgICAgICAvLyBHZXRMaXN0QWN0aW9uOjpzd2VlcFN0YWxlSW5zdGFsbHMpIGZsaXAgdGhlIHJvdyB0byBgZmFpbGVkYFxuICAgICAgICAgICAgLy8gaWYgdGhlIGRvd25sb2FkIGFjdHVhbGx5IGRpZWQg4oCUIHRoZSBVSSB0aGVuIHNob3dzIFJldHJ5LlxuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZUluc3RhbGxUaW1lb3V0KTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VzLFxuICAgICAgICAgICAgbWV0aG9kOiAnR0VUJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCBsaXN0ID0gKHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGEpIHx8IFtdO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzID0gbGlzdDtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlbmRlclZvaWNlc1RhYmxlKCk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJWb2ljZVBpY2tlcigpO1xuICAgICAgICAgICAgY29uc3Qgdm9pY2UgPSBsaXN0LmZpbmQoKHYpID0+IHYudm9pY2VfaWQgPT09IHZvaWNlSWQpO1xuICAgICAgICAgICAgaWYgKCF2b2ljZSkge1xuICAgICAgICAgICAgICAgIC8vIFJvdyB2YW5pc2hlZCAodXNlciBwcmVzc2VkIFJlbW92ZSBtaWQtaW5zdGFsbCk6IGRyb3AgdGhlIHRpbWVyLlxuICAgICAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LmNhbmNlbEluc3RhbGxQb2xsKHZvaWNlSWQpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh2b2ljZS5pbnN0YWxsX3N0YXR1cyA9PT0gJ2luc3RhbGxlZCcpIHtcbiAgICAgICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5jYW5jZWxJbnN0YWxsUG9sbCh2b2ljZUlkKTtcbiAgICAgICAgICAgICAgICAvLyBObyB0b2FzdCDigJQgdGhlIHJvdyBhbHJlYWR5IHR1cm5lZCBncmVlbiB3aXRoIHRoZSBuZXcgc3RhdHVzXG4gICAgICAgICAgICAgICAgLy8gYW5kIHRoZSBhY3Rpb24gYnV0dG9uIGJlY2FtZSBSZW1vdmUuIEZhaWx1cmVzIHN0aWxsIHRvYXN0LFxuICAgICAgICAgICAgICAgIC8vIGJlY2F1c2UgaW5zdGFsbF9lcnJvciBuZWVkcyBzdXJmYWNpbmcgc29tZXdoZXJlLlxuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICh2b2ljZS5pbnN0YWxsX3N0YXR1cyA9PT0gJ2ZhaWxlZCcpIHtcbiAgICAgICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5jYW5jZWxJbnN0YWxsUG9sbCh2b2ljZUlkKTtcbiAgICAgICAgICAgICAgICBjb25zdCBkZXRhaWwgPSB2b2ljZS5pbnN0YWxsX2Vycm9yXG4gICAgICAgICAgICAgICAgICAgID8gYCR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VJbnN0YWxsfSAke3ZvaWNlLmluc3RhbGxfZXJyb3J9YFxuICAgICAgICAgICAgICAgICAgICA6IGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvclZvaWNlSW5zdGFsbDtcbiAgICAgICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZGV0YWlsKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBzdGF0dXMgPT09ICdpbnN0YWxsaW5nJyDihpIga2VlcCB0aWNraW5nXG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICBvblZvaWNlVW5pbnN0YWxsKCkge1xuICAgICAgICBjb25zdCAkYnRuID0gJCh0aGlzKTtcbiAgICAgICAgY29uc3Qgdm9pY2VJZCA9ICRidG4uZGF0YSgndm9pY2UnKTtcbiAgICAgICAgJGJ0bi5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAvLyBDYW5jZWwgYW55IGluLWZsaWdodCBpbnN0YWxsIHBvbGwgZm9yIHRoaXMgdm9pY2Ug4oCUIFJlbW92ZSBvbiBhXG4gICAgICAgIC8vICdmYWlsZWQnIG9yICdpbnN0YWxsaW5nJyByb3cgc2hvdWxkIGNsZWFyIHRoZSBwbGFjZWhvbGRlciBjbGVhbmx5LlxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5jYW5jZWxJbnN0YWxsUG9sbCh2b2ljZUlkKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogYCR7cGhyYXNlU3R1ZGlvSW5kZXguYXBpLnZvaWNlc30vJHtlbmNvZGVVUklDb21wb25lbnQodm9pY2VJZCl9YCxcbiAgICAgICAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKCgpID0+IHtcbiAgICAgICAgICAgIC8vIE5vIHRvYXN0IOKAlCB0aGUgcm93IHJldmVydHMgdG8gdGhlIG5vdC1pbnN0YWxsZWQgbGFiZWwgYW5kIHNob3dzXG4gICAgICAgICAgICAvLyBhbiBJbnN0YWxsIGJ1dHRvbiwgd2hpY2ggaXMgZW5vdWdoIGNvbmZpcm1hdGlvbiBmb3IgYSBkZWxldGUuXG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoVm9pY2VzKCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvclZvaWNlVW5pbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIG9uR2VuZXJhdGUoKSB7XG4gICAgICAgIGNvbnN0IHRleHQgICAgICAgPSAoJCgnI3BocmFzZS1zdHVkaW8tdGV4dCcpLnZhbCgpIHx8ICcnKS50cmltKCk7XG4gICAgICAgIGNvbnN0IHZvaWNlSWQgICAgPSAkKCcjcGhyYXNlLXN0dWRpby12b2ljZScpLnZhbCgpIHx8ICcnO1xuICAgICAgICBjb25zdCBzYW1wbGVSYXRlID0gJCgnI3BocmFzZS1zdHVkaW8tc2FtcGxlLXJhdGUnKS52YWwoKSB8fCAnbmF0aXZlJztcbiAgICAgICAgaWYgKCF0ZXh0IHx8ICF2b2ljZUlkKSB7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZhbGlkYXRpb25NaXNzaW5nKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCAkYnRuID0gJCgnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtYnV0dG9uJykuYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLnBocmFzZXMsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KHt0ZXh0LCB2b2ljZV9pZDogdm9pY2VJZCwgc2FtcGxlX3JhdGU6IHNhbXBsZVJhdGV9KSxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgY29uc3QgZGF0YSA9IHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGE7XG4gICAgICAgICAgICBpZiAoIWRhdGEgfHwgIWRhdGEucGhyYXNlX2lkKSB7XG4gICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKHJlc3BvbnNlICYmIHJlc3BvbnNlLm1lc3NhZ2VzXG4gICAgICAgICAgICAgICAgICAgID8gcmVzcG9uc2UubWVzc2FnZXNcbiAgICAgICAgICAgICAgICAgICAgOiBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JHZW5lcmF0ZSk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCQoJyNwaHJhc2Utc3R1ZGlvLXJlbWVtYmVyJykuaXMoJzpjaGVja2VkJykpIHtcbiAgICAgICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5wZXJzaXN0RGVmYXVsdHModm9pY2VJZCwgc2FtcGxlUmF0ZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAvLyBIaXN0b3J5IHRhYmxlIGxpdmVzIHJpZ2h0IHVuZGVyIHRoZSBmb3JtIG9uIHRoZSBTdHVkaW8gdGFiLFxuICAgICAgICAgICAgLy8gc28gYSByZWZyZXNoIGlzIGVub3VnaCDigJQgbm8gdGFiIHN3aXRjaC5cbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hIaXN0b3J5KCk7XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckdlbmVyYXRlKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHBlcnNpc3REZWZhdWx0cyh2b2ljZUlkLCBzYW1wbGVSYXRlKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS5zYXZlRGVmYXVsdHMsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIGRhdGE6IHtkZWZhdWx0X3ZvaWNlOiB2b2ljZUlkLCBkZWZhdWx0X3NhbXBsZV9yYXRlOiBzYW1wbGVSYXRlfSxcbiAgICAgICAgfSkuZG9uZSgoKSA9PiB7XG4gICAgICAgICAgICB3aW5kb3cucGhyYXNlU3R1ZGlvRGVmYXVsdHMgPSB7dm9pY2U6IHZvaWNlSWQsIHNhbXBsZVJhdGV9O1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcmVmcmVzaEhpc3RvcnkoY2FsbGJhY2spIHtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLnBocmFzZXMsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IHJvd3MgPSAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSkgfHwgW107XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5sYXN0SGlzdG9yeVJvd3MgPSByb3dzO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVySGlzdG9yeShyb3dzKTtcbiAgICAgICAgICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcmVuZGVySGlzdG9yeShyb3dzKSB7XG4gICAgICAgIC8vIFRlYXIgZG93biBEYXRhVGFibGUgKyBzb3VuZCBwbGF5ZXJzIGZyb20gdGhlIHByZXZpb3VzIHJlbmRlci5cbiAgICAgICAgaWYgKHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmhpc3RvcnlEYXRhVGFibGVcbiAgICAgICAgICAgICYmICQuZm4uRGF0YVRhYmxlLmlzRGF0YVRhYmxlKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJykpIHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmhpc3RvcnlEYXRhVGFibGUuZGVzdHJveSgpO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaGlzdG9yeURhdGFUYWJsZSA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgICAgT2JqZWN0LnZhbHVlcyhwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5zb3VuZFBsYXllcnMpLmZvckVhY2goKHApID0+IHtcbiAgICAgICAgICAgIGlmIChwICYmIHAuaHRtbDVBdWRpbykge1xuICAgICAgICAgICAgICAgIHAuaHRtbDVBdWRpby5wYXVzZSgpO1xuICAgICAgICAgICAgICAgIHAuaHRtbDVBdWRpby5zcmMgPSAnJztcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnNvdW5kUGxheWVycyA9IHt9O1xuXG4gICAgICAgIGNvbnN0ICR0Ym9keSA9ICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUgdGJvZHknKS5lbXB0eSgpO1xuICAgICAgICByb3dzLmZvckVhY2goKHJvdykgPT4ge1xuICAgICAgICAgICAgJHRib2R5LmFwcGVuZChwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJIaXN0b3J5Um93KHJvdykpO1xuICAgICAgICB9KTtcblxuICAgICAgICBjb25zdCAkdGFibGVXcmFwID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpLmNsb3Nlc3QoJy5kYXRhVGFibGVzX3dyYXBwZXInKTtcbiAgICAgICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJykuaGlkZSgpO1xuICAgICAgICAgICAgKCR0YWJsZVdyYXAubGVuZ3RoID8gJHRhYmxlV3JhcCA6ICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKSkuaGlkZSgpO1xuICAgICAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS1lbXB0eScpLnNob3coKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LWVtcHR5JykuaGlkZSgpO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJykuc2hvdygpO1xuICAgICAgICBpZiAoJHRhYmxlV3JhcC5sZW5ndGgpIHtcbiAgICAgICAgICAgICR0YWJsZVdyYXAuc2hvdygpO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gSW5pdGlhbGlzZSBEYXRhVGFibGUgKyBzb3VuZCBwbGF5ZXJzLCBtaXJyb3JpbmcgU291bmRGaWxlcyBpbmRleC5cbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaGlzdG9yeURhdGFUYWJsZSA9ICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5EYXRhVGFibGUoe1xuICAgICAgICAgICAgbGVuZ3RoQ2hhbmdlOiBmYWxzZSxcbiAgICAgICAgICAgIHBhZ2luZzogdHJ1ZSxcbiAgICAgICAgICAgIHBhZ2VMZW5ndGg6IDI1LFxuICAgICAgICAgICAgc2VhcmNoaW5nOiB0cnVlLFxuICAgICAgICAgICAgaW5mbzogZmFsc2UsXG4gICAgICAgICAgICBvcmRlcmluZzogdHJ1ZSxcbiAgICAgICAgICAgIGxhbmd1YWdlOiB0eXBlb2YgU2VtYW50aWNMb2NhbGl6YXRpb24gIT09ICd1bmRlZmluZWQnXG4gICAgICAgICAgICAgICAgPyBTZW1hbnRpY0xvY2FsaXphdGlvbi5kYXRhVGFibGVMb2NhbGlzYXRpb25cbiAgICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICAgICAgICAgIG9yZGVyOiBbWzAsICdkZXNjJ11dLFxuICAgICAgICB9KTtcblxuICAgICAgICByb3dzLmZvckVhY2goKHJvdykgPT4ge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuc291bmRQbGF5ZXJzW3Jvdy5pZF0gPVxuICAgICAgICAgICAgICAgIG5ldyBJbmRleFNvdW5kUGxheWVyKGBwaHJhc2Utcm93LSR7cm93LmlkfWApO1xuICAgICAgICB9KTtcblxuICAgICAgICAvLyBTdGFuZGFyZCBNaWtvUEJYIHR3by1zdGVwIGRlbGV0ZSAoZGVsZXRlLXNvbWV0aGluZy5qcykgZmxpcHMgdGhlXG4gICAgICAgIC8vICd0d28tc3RlcHMtZGVsZXRlJyBjbGFzcyBvZmYgb24gdGhlIGZpcnN0IGNsaWNrLiBXZSBsaXN0ZW4gZm9yIHRoZVxuICAgICAgICAvLyAqc2Vjb25kKiBjbGljayAod2hlbiB0aGUgY2xhc3MgaXMgZ29uZSkgdG8gZmlyZSB0aGUgUkVTVCBERUxFVEUuXG4gICAgICAgICQoJ2JvZHknKS5vZmYoJ2NsaWNrLnBocmFzZVN0dWRpbycpO1xuICAgICAgICAkKCdib2R5Jykub24oJ2NsaWNrLnBocmFzZVN0dWRpbycsICdhLmRlbGV0ZTpub3QoLnR3by1zdGVwcy1kZWxldGUpJywgZnVuY3Rpb24gb25Db25maXJtZWREZWxldGUoZSkge1xuICAgICAgICAgICAgY29uc3QgJHRhcmdldCA9ICQoZS50YXJnZXQpLmNsb3Nlc3QoJ2EuZGVsZXRlJyk7XG4gICAgICAgICAgICBpZiAoJHRhcmdldC5jbG9zZXN0KCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJykubGVuZ3RoID09PSAwKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZS5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICAgICAgZS5zdG9wSW1tZWRpYXRlUHJvcGFnYXRpb24oKTtcbiAgICAgICAgICAgIGNvbnN0IGlkID0gJHRhcmdldC5hdHRyKCdkYXRhLXZhbHVlJyk7XG4gICAgICAgICAgICBpZiAoIWlkKSByZXR1cm47XG4gICAgICAgICAgICAkdGFyZ2V0LmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgICAgIHVybDogYCR7cGhyYXNlU3R1ZGlvSW5kZXguYXBpLnBocmFzZXN9LyR7aWR9YCxcbiAgICAgICAgICAgICAgICBtZXRob2Q6ICdERUxFVEUnLFxuICAgICAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgICAgICB9KS5kb25lKCgpID0+IHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hIaXN0b3J5KCkpXG4gICAgICAgICAgICAgIC5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgICAgICAgICR0YXJnZXQucmVtb3ZlQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JIaXN0b3J5RGVsZXRlKTtcbiAgICAgICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuICAgICAgICBjb25zdCAkdGJsID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpO1xuICAgICAgICAkdGJsLmZpbmQoJy5wb3B1cGVkJykucG9wdXAoKTtcbiAgICAgICAgLy8gQ2xpY2sgb24gdGhlIHRleHQgY2VsbCDihpIgY29weSBwaHJhc2UgdGV4dCArIHZvaWNlIGJhY2sgaW50byB0aGUgZm9ybVxuICAgICAgICAvLyBzbyB0aGUgdXNlciBjYW4gZWRpdCBhbmQgcmUtZ2VuZXJhdGUgd2l0aG91dCByZXR5cGluZy4gS2VlcHMgdGhlXG4gICAgICAgIC8vIHBsYXllciAvIGRvd25sb2FkIC8gZGVsZXRlIGJ1dHRvbnMgY2xpY2thYmxlIG9uIHRoZWlyIG93bi5cbiAgICAgICAgJHRibC5vZmYoJ2NsaWNrLnBocmFzZVN0dWRpbycpO1xuICAgICAgICAkdGJsLm9uKCdjbGljay5waHJhc2VTdHVkaW8nLCAndGQucGhyYXNlLXJldXNlJywgZnVuY3Rpb24gb25SZXVzZSgpIHtcbiAgICAgICAgICAgIGNvbnN0ICRyb3cgPSAkKHRoaXMpLmNsb3Nlc3QoJ3RyJyk7XG4gICAgICAgICAgICBjb25zdCB0ZXh0ID0gJHJvdy5hdHRyKCdkYXRhLXRleHQnKSB8fCAnJztcbiAgICAgICAgICAgIGNvbnN0IHZvaWNlID0gJHJvdy5hdHRyKCdkYXRhLXZvaWNlJykgfHwgJyc7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykudmFsKHRleHQpLnRyaWdnZXIoJ2lucHV0Jyk7XG4gICAgICAgICAgICBpZiAodm9pY2UpIHtcbiAgICAgICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby12b2ljZScpLmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCB2b2ljZSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICAkKCdodG1sLCBib2R5JykuYW5pbWF0ZSh7c2Nyb2xsVG9wOiAkKCcjcGhyYXNlLXN0dWRpby10ZXh0Jykub2Zmc2V0KCkudG9wIC0gODB9LCAyMDApO1xuICAgICAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tdGV4dCcpLmZvY3VzKCk7XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBSZXNvbHZlcyBhIHBocmFzZSByb3cncyB2b2ljZV9pZCBpbnRvIGEgXCLwn4e38J+HuiBJcmluYSAobWVkaXVtKVwiIHN0cmluZyB3aXRoXG4gICAgICogdGhlIG1hdGNoaW5nIFNlbWFudGljIFVJIGZsYWcuIEZhbGxzIGJhY2sgdG8gdGhlIHJhdyB2b2ljZV9pZCB3aGVuIHRoZVxuICAgICAqIHZvaWNlIGlzIG5vdCBpbiB0aGUgbG9hZGVkIGNhdGFsb2d1ZSAoZS5nLiB1c2VyIHJlbW92ZWQgdGhlIHZvaWNlIGJ1dFxuICAgICAqIHRoZSBwaHJhc2Ugcm93IGZyb20gYmVmb3JlIGlzIHN0aWxsIGluIGhpc3RvcnkpLlxuICAgICAqL1xuICAgIGZvcm1hdFZvaWNlTGFiZWwodm9pY2VJZCkge1xuICAgICAgICBjb25zdCBlc2NBdHRyID0gKHMpID0+ICQoJzxkaXY+JykudGV4dChzKS5odG1sKCkucmVwbGFjZSgvXCIvZywgJyZxdW90OycpO1xuICAgICAgICBpZiAoIXZvaWNlSWQpIHJldHVybiAnPHNwYW4gY2xhc3M9XCJ1aSBsYWJlbFwiPuKAlDwvc3Bhbj4nO1xuICAgICAgICBjb25zdCB2b2ljZSA9IHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnZvaWNlcy5maW5kKCh2KSA9PiB2LnZvaWNlX2lkID09PSB2b2ljZUlkKTtcbiAgICAgICAgaWYgKCF2b2ljZSkge1xuICAgICAgICAgICAgLy8gVm9pY2Ugbm8gbG9uZ2VyIGluc3RhbGxlZCDigJQga2VlcCByYXcgaWQgc28gdGhlIHVzZXIgY2FuXG4gICAgICAgICAgICAvLyBpZGVudGlmeSB3aGljaCBoaXN0b3JpYyBwaHJhc2UgdXNlZCB3aGF0IG1vZGVsLlxuICAgICAgICAgICAgcmV0dXJuICQoJzxkaXY+JykudGV4dCh2b2ljZUlkKS5odG1sKCk7XG4gICAgICAgIH1cbiAgICAgICAgY29uc3QgZmxhZyA9IHBocmFzZVN0dWRpb0luZGV4LmZsYWdDbGFzc0Zvcih2b2ljZS5sYW5ndWFnZSk7XG4gICAgICAgIGNvbnN0IGZsYWdIdG1sID0gZmxhZyA/IGA8aSBjbGFzcz1cIiR7ZmxhZ30gZmxhZ1wiIHRpdGxlPVwiJHtlc2NBdHRyKHZvaWNlLmxhbmd1YWdlX2xhYmVsKX1cIj48L2k+YCA6ICcnO1xuICAgICAgICBjb25zdCBsYWJlbCA9IGAke3ZvaWNlLnZvaWNlX25hbWV9ICgke3ZvaWNlLnF1YWxpdHl9KWA7XG4gICAgICAgIHJldHVybiBgJHtmbGFnSHRtbH0keyQoJzxkaXY+JykudGV4dChsYWJlbCkuaHRtbCgpfWA7XG4gICAgfSxcblxuICAgIHJlbmRlckhpc3RvcnlSb3cocm93KSB7XG4gICAgICAgIGNvbnN0IGNyZWF0ZWQgICA9IHJvdy5jcmVhdGVkX2F0ID8gbmV3IERhdGUocm93LmNyZWF0ZWRfYXQgKiAxMDAwKS50b0xvY2FsZVN0cmluZygpIDogJ+KAlCc7XG4gICAgICAgIGNvbnN0IGZ1bGxUZXh0ICA9IHJvdy50ZXh0IHx8ICcnO1xuICAgICAgICBjb25zdCBzaG9ydFRleHQgPSBmdWxsVGV4dC5sZW5ndGggPiA4MCA/IGAke2Z1bGxUZXh0LnN1YnN0cmluZygwLCA4MCl94oCmYCA6IGZ1bGxUZXh0O1xuICAgICAgICBjb25zdCB2b2ljZUlkICAgPSByb3cudm9pY2VfaWQgfHwgJyc7XG4gICAgICAgIGNvbnN0IHBsYXlVcmwgICA9IGAke3BocmFzZVN0dWRpb0luZGV4LmFwaS5waHJhc2VzfS8ke3Jvdy5pZH06ZG93bmxvYWRgO1xuICAgICAgICBjb25zdCBkbFVybCAgICAgPSBwbGF5VXJsO1xuICAgICAgICBjb25zdCBmaWxlbmFtZSAgPSBgcGhyYXNlXyR7cm93LmlkfS53YXZgO1xuICAgICAgICBjb25zdCB0b29sdGlwICAgPSBnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fUm93UmV1c2VUb29sdGlwIHx8ICcnO1xuICAgICAgICBjb25zdCBlc2NBdHRyICAgPSAocykgPT4gJCgnPGRpdj4nKS50ZXh0KHMpLmh0bWwoKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7Jyk7XG4gICAgICAgIHJldHVybiBgPHRyIGNsYXNzPVwiZmlsZS1yb3dcIiBpZD1cInBocmFzZS1yb3ctJHtyb3cuaWR9XCJcbiAgICAgICAgICAgICAgICAgICAgZGF0YS12YWx1ZT1cIiR7cGxheVVybH1cIlxuICAgICAgICAgICAgICAgICAgICBkYXRhLXRleHQ9XCIke2VzY0F0dHIoZnVsbFRleHQpfVwiXG4gICAgICAgICAgICAgICAgICAgIGRhdGEtdm9pY2U9XCIke2VzY0F0dHIodm9pY2VJZCl9XCI+XG4gICAgICAgICAgICA8dGQ+JHskKCc8ZGl2PicpLnRleHQoY3JlYXRlZCkuaHRtbCgpfTwvdGQ+XG4gICAgICAgICAgICA8dGQgY2xhc3M9XCJwaHJhc2UtcmV1c2VcIiBzdHlsZT1cImN1cnNvcjpwb2ludGVyXCIgdGl0bGU9XCIke2VzY0F0dHIodG9vbHRpcCl9XCI+XG4gICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJmaWxlIGF1ZGlvIG91dGxpbmUgaWNvblwiPjwvaT4keyQoJzxkaXY+JykudGV4dChzaG9ydFRleHQpLmh0bWwoKX1cbiAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICA8dGQ+JHtwaHJhc2VTdHVkaW9JbmRleC5mb3JtYXRWb2ljZUxhYmVsKHZvaWNlSWQpfTwvdGQ+XG4gICAgICAgICAgICA8dGQgY2xhc3M9XCJzaXggd2lkZSBjZHItcGxheWVyIGhpZGUtb24tbW9iaWxlXCI+XG4gICAgICAgICAgICAgICAgPHRhYmxlPlxuICAgICAgICAgICAgICAgICAgICA8dHI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3M9XCJvbmUgd2lkZVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJ1aSB0aW55IGJhc2ljIGljb24gYnV0dG9uIHBsYXktYnV0dG9uXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxpIGNsYXNzPVwidWkgaWNvbiBwbGF5XCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxhdWRpbyBwcmVsb2FkPVwibm9uZVwiIGlkPVwiYXVkaW8tcGxheWVyLXBocmFzZS1yb3ctJHtyb3cuaWR9XCIgZGF0YS1zcmM9XCIke3BsYXlVcmx9XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxzb3VyY2Ugc3JjPVwiXCIvPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYXVkaW8+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ1aSByYW5nZSBjZHItcGxheWVyXCI+PC9kaXY+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj48c3BhbiBjbGFzcz1cImNkci1kdXJhdGlvblwiPjwvc3Bhbj48L3RkPlxuICAgICAgICAgICAgICAgICAgICAgICAgPHRkIGNsYXNzPVwib25lIHdpZGVcIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICA8YnV0dG9uIGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbiBkb3dubG9hZC1idXR0b25cIiBkYXRhLXZhbHVlPVwiJHtkbFVybH0/ZmlsZW5hbWU9JHtmaWxlbmFtZX1cIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJ1aSBpY29uIGRvd25sb2FkXCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDwvYnV0dG9uPlxuICAgICAgICAgICAgICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgICAgICAgICAgPC90cj5cbiAgICAgICAgICAgICAgICA8L3RhYmxlPlxuICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgIDx0ZCBjbGFzcz1cImNvbGxhcHNpbmdcIj5cbiAgICAgICAgICAgICAgICA8ZGl2IGNsYXNzPVwidWkgdGlueSBiYXNpYyBpY29uIGJ1dHRvbnMgYWN0aW9uLWJ1dHRvbnNcIj5cbiAgICAgICAgICAgICAgICAgICAgPGEgaHJlZj1cIiNcIiBkYXRhLXZhbHVlPVwiJHtyb3cuaWR9XCJcbiAgICAgICAgICAgICAgICAgICAgICAgY2xhc3M9XCJ1aSBidXR0b24gZGVsZXRlIHR3by1zdGVwcy1kZWxldGUgcG9wdXBlZFwiXG4gICAgICAgICAgICAgICAgICAgICAgIGRhdGEtY29udGVudD1cIiR7ZXNjQXR0cihnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fSGlzdG9yeURlbGV0ZSl9XCI+XG4gICAgICAgICAgICAgICAgICAgICAgICA8aSBjbGFzcz1cImljb24gdHJhc2ggcmVkXCI+PC9pPlxuICAgICAgICAgICAgICAgICAgICA8L2E+XG4gICAgICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgICA8L3RkPlxuICAgICAgICA8L3RyPmA7XG4gICAgfSxcbn07XG5cbiQoZG9jdW1lbnQpLnJlYWR5KCgpID0+IHtcbiAgICBwaHJhc2VTdHVkaW9JbmRleC5pbml0aWFsaXplKCk7XG59KTtcbiJdfQ==