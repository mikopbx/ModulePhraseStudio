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
    var installingVoiceIds = [];
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
        installingVoiceIds.push(voice.voice_id);
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
    }); // If the page opened mid-install, re-arm bounded polling for those
    // rows so the spinner resolves when the detached worker finishes.

    installingVoiceIds.forEach(function (voiceId) {
      phraseStudioIndex.scheduleInstallPoll(voiceId);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInNyYy9tb2R1bGUtcGhyYXNlLXN0dWRpby1pbmRleC5qcyJdLCJuYW1lcyI6WyJwaHJhc2VTdHVkaW9JbmRleCIsImFwaSIsImVuZ2luZSIsImVuZ2luZUluc3RhbGwiLCJ2b2ljZXMiLCJ2b2ljZUluc3RhbGwiLCJwaHJhc2VzIiwic2F2ZURlZmF1bHRzIiwiZ2xvYmFsUm9vdFVybCIsInN0YXRlIiwic291bmRQbGF5ZXJzIiwiaGlzdG9yeURhdGFUYWJsZSIsImluc3RhbGxQb2xscyIsIklOU1RBTExfUE9MTF9JTlRFUlZBTF9NUyIsIklOU1RBTExfUE9MTF9NQVhfQVRURU1QVFMiLCJpbml0aWFsaXplIiwiJCIsInRhYiIsImNoZWNrYm94IiwiZHJvcGRvd24iLCJ3aW5kb3ciLCJwaHJhc2VTdHVkaW9EZWZhdWx0cyIsImRpc2FibGVkIiwicHJvcCIsIm9uIiwidXBkYXRlQ291bnRlciIsIm9uR2VuZXJhdGUiLCJyZWZyZXNoVm9pY2VzIiwicmVmcmVzaEVuZ2luZSIsInJlZnJlc2hIaXN0b3J5IiwiYXBwbHlEZWZhdWx0cyIsImQiLCJzYW1wbGVSYXRlIiwidmFsdWUiLCJ2YWwiLCJtYXgiLCJwYXJzZUludCIsImF0dHIiLCJ0ZXh0IiwibGVuZ3RoIiwiYWpheCIsInVybCIsIm1ldGhvZCIsImRhdGFUeXBlIiwiZG9uZSIsInJlc3BvbnNlIiwiZGF0YSIsInJlbmRlckVuZ2luZSIsImZhaWwiLCJVc2VyTWVzc2FnZSIsInNob3dNdWx0aVN0cmluZyIsImdsb2JhbFRyYW5zbGF0ZSIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yRW5naW5lU3RhdHVzIiwiJGJveCIsImVtcHR5IiwiaW5zdGFsbGVkIiwiYXBwZW5kIiwiYWRkQ2xhc3MiLCJtb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVJbnN0YWxsZWQiLCJtb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVWZXJzaW9uIiwidmVyc2lvbiIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZVVwZGF0ZSIsIm9uRW5naW5lVXBkYXRlIiwibW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lTm90SW5zdGFsbGVkIiwibW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lSW5zdGFsbEhpbnQiLCJtb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVJbnN0YWxsIiwib25FbmdpbmVJbnN0YWxsIiwiZGlzcGF0Y2hFbmdpbmVJbnN0YWxsIiwiJGJ0biIsImZvcmNlIiwiSlNPTiIsInN0cmluZ2lmeSIsImNvbnRlbnRUeXBlIiwicmVtb3ZlQ2xhc3MiLCJyZXN1bHQiLCJtZXNzYWdlcyIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yRW5naW5lSW5zdGFsbCIsImxhc3RIaXN0b3J5Um93cyIsInJlbmRlclZvaWNlc1RhYmxlIiwicmVuZGVyVm9pY2VQaWNrZXIiLCJyZW5kZXJIaXN0b3J5IiwibW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZXNMaXN0IiwiZmxhZ0NsYXNzRm9yIiwibGFuZ3VhZ2UiLCJwYXJ0cyIsIlN0cmluZyIsInRvTG93ZXJDYXNlIiwic3BsaXQiLCJjYyIsIiR0Ym9keSIsImluc3RhbGxpbmdWb2ljZUlkcyIsImZvckVhY2giLCJ2b2ljZSIsIiRyb3ciLCJ2b2ljZV9pZCIsImZsYWciLCIkbGFuZyIsImRvY3VtZW50IiwiY3JlYXRlVGV4dE5vZGUiLCJsYW5ndWFnZV9sYWJlbCIsInZvaWNlX25hbWUiLCJxdWFsaXR5Iiwic2FtcGxlX3JhdGUiLCJzdGF0dXMiLCJpbnN0YWxsX3N0YXR1cyIsIiRzdGF0dXNDZWxsIiwiaHRtbCIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbGVkIiwicHVzaCIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbGluZyIsImVyciIsImluc3RhbGxfZXJyb3IiLCJtb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZUZhaWxlZCIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlTm90SW5zdGFsbGVkIiwiJGFjdGlvbnMiLCJtb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZURlbGV0ZSIsIm9uVm9pY2VVbmluc3RhbGwiLCJsYWJlbCIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlUmV0cnkiLCJtb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZUluc3RhbGwiLCJvblZvaWNlSW5zdGFsbCIsInZvaWNlSWQiLCJzY2hlZHVsZUluc3RhbGxQb2xsIiwiJHNlbGVjdCIsInByZXZpb3VzIiwiZmFsbGJhY2siLCJmaWx0ZXIiLCJ2IiwibW9kdWxlX3BocmFzZV9zdHVkaW9fUGlja2VyRW1wdHkiLCIkb3B0IiwiZnVsbFRleHRTZWFyY2giLCJ3YW50IiwibW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZUluc3RhbGwiLCJwb2xscyIsInN0YXJ0ZWRBdCIsIkRhdGUiLCJub3ciLCJhdHRlbXB0cyIsInRpbWVyIiwic2V0SW50ZXJ2YWwiLCJ0aWNrSW5zdGFsbFBvbGwiLCJjYW5jZWxJbnN0YWxsUG9sbCIsImVudHJ5IiwiY2xlYXJJbnRlcnZhbCIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbFRpbWVvdXQiLCJsaXN0IiwiZmluZCIsImRldGFpbCIsImVuY29kZVVSSUNvbXBvbmVudCIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VVbmluc3RhbGwiLCJ0cmltIiwibW9kdWxlX3BocmFzZV9zdHVkaW9fVmFsaWRhdGlvbk1pc3NpbmciLCJwaHJhc2VfaWQiLCJtb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckdlbmVyYXRlIiwiaXMiLCJwZXJzaXN0RGVmYXVsdHMiLCJkZWZhdWx0X3ZvaWNlIiwiZGVmYXVsdF9zYW1wbGVfcmF0ZSIsImNhbGxiYWNrIiwicm93cyIsImZuIiwiRGF0YVRhYmxlIiwiaXNEYXRhVGFibGUiLCJkZXN0cm95IiwiT2JqZWN0IiwidmFsdWVzIiwicCIsImh0bWw1QXVkaW8iLCJwYXVzZSIsInNyYyIsInJvdyIsInJlbmRlckhpc3RvcnlSb3ciLCIkdGFibGVXcmFwIiwiY2xvc2VzdCIsImhpZGUiLCJzaG93IiwibGVuZ3RoQ2hhbmdlIiwicGFnaW5nIiwicGFnZUxlbmd0aCIsInNlYXJjaGluZyIsImluZm8iLCJvcmRlcmluZyIsIlNlbWFudGljTG9jYWxpemF0aW9uIiwiZGF0YVRhYmxlTG9jYWxpc2F0aW9uIiwidW5kZWZpbmVkIiwib3JkZXIiLCJpZCIsIkluZGV4U291bmRQbGF5ZXIiLCJvZmYiLCJvbkNvbmZpcm1lZERlbGV0ZSIsImUiLCIkdGFyZ2V0IiwidGFyZ2V0IiwicHJldmVudERlZmF1bHQiLCJzdG9wSW1tZWRpYXRlUHJvcGFnYXRpb24iLCJtb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckhpc3RvcnlEZWxldGUiLCIkdGJsIiwicG9wdXAiLCJvblJldXNlIiwidHJpZ2dlciIsImFuaW1hdGUiLCJzY3JvbGxUb3AiLCJvZmZzZXQiLCJ0b3AiLCJmb2N1cyIsImZvcm1hdFZvaWNlTGFiZWwiLCJlc2NBdHRyIiwicyIsInJlcGxhY2UiLCJmbGFnSHRtbCIsImNyZWF0ZWQiLCJjcmVhdGVkX2F0IiwidG9Mb2NhbGVTdHJpbmciLCJmdWxsVGV4dCIsInNob3J0VGV4dCIsInN1YnN0cmluZyIsInBsYXlVcmwiLCJkbFVybCIsImZpbGVuYW1lIiwidG9vbHRpcCIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1Jvd1JldXNlVG9vbHRpcCIsIm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0hpc3RvcnlEZWxldGUiLCJyZWFkeSJdLCJtYXBwaW5ncyI6Ijs7QUFBQTs7QUFFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLElBQU1BLGlCQUFpQixHQUFHO0FBQ3RCQyxFQUFBQSxHQUFHLEVBQUU7QUFDREMsSUFBQUEsTUFBTSxFQUFTLDZDQURkO0FBRURDLElBQUFBLGFBQWEsRUFBRSxxREFGZDtBQUdEQyxJQUFBQSxNQUFNLEVBQVMsNkNBSGQ7QUFJREMsSUFBQUEsWUFBWSxFQUFHLHFEQUpkO0FBS0RDLElBQUFBLE9BQU8sRUFBUSw4Q0FMZDtBQU1EQyxJQUFBQSxZQUFZLEVBQUdD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bG9iYWxUcmFuc2xhdGUsIFBieEFwaSwgVXNlck1lc3NhZ2UsIEluZGV4U291bmRQbGF5ZXIsIFRva2VuTWFuYWdlciwgU2VtYW50aWNMb2NhbGl6YXRpb24gKi9cblxuLyoqXG4gKiBTdHVkaW8gcGFnZSBjb250cm9sbGVyIGZvciBNb2R1bGVQaHJhc2VTdHVkaW8uXG4gKlxuICogVGhlIHBhZ2UgaGFzIGZvdXIgdGFicyAoc3R1ZGlvIC8gdm9pY2VzIC8gZW5naW5lIC8gaGlzdG9yeSkuIEFsbCBkYXRhIGZsb3dzXG4gKiB0aHJvdWdoIHRoZSBtb2R1bGUncyBSRVNUIHYzIGVuZHBvaW50cyB1bmRlciAvcGJ4Y29yZS9hcGkvdjMvbW9kdWxlLXBocmFzZS1zdHVkaW8uXG4gKiBXZSByZWx5IG9uIFBieEFwaS5jYWxsSnNvblJlc3QgaGVscGVyLCB3aGljaCBhbHJlYWR5IGhhbmRsZXMgYXV0aCBoZWFkZXJzLlxuICovXG5jb25zdCBwaHJhc2VTdHVkaW9JbmRleCA9IHtcbiAgICBhcGk6IHtcbiAgICAgICAgZW5naW5lOiAgICAgICAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby9lbmdpbmUnLFxuICAgICAgICBlbmdpbmVJbnN0YWxsOiAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL2VuZ2luZTppbnN0YWxsJyxcbiAgICAgICAgdm9pY2VzOiAgICAgICAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby92b2ljZXMnLFxuICAgICAgICB2b2ljZUluc3RhbGw6ICAnL3BieGNvcmUvYXBpL3YzL21vZHVsZS1waHJhc2Utc3R1ZGlvL3ZvaWNlczppbnN0YWxsJyxcbiAgICAgICAgcGhyYXNlczogICAgICAgJy9wYnhjb3JlL2FwaS92My9tb2R1bGUtcGhyYXNlLXN0dWRpby9waHJhc2VzJyxcbiAgICAgICAgc2F2ZURlZmF1bHRzOiAgZ2xvYmFsUm9vdFVybCArICdtb2R1bGUtcGhyYXNlLXN0dWRpby9tb2R1bGUtcGhyYXNlLXN0dWRpby9zYXZlJyxcbiAgICB9LFxuXG4gICAgc3RhdGU6IHtcbiAgICAgICAgZW5naW5lOiBudWxsLFxuICAgICAgICB2b2ljZXM6IFtdLFxuICAgICAgICBzb3VuZFBsYXllcnM6IHt9LFxuICAgICAgICBoaXN0b3J5RGF0YVRhYmxlOiBudWxsLFxuICAgICAgICAvLyB2b2ljZV9pZCDihpIgeyBzdGFydGVkQXQsIGF0dGVtcHRzLCB0aW1lciB9IGZvciBpbnN0YWxscyBpbiBmbGlnaHQuXG4gICAgICAgIC8vIFRyYWNraW5nIGF0dGVtcHRzIGNsaWVudC1zaWRlIGxldHMgdXMgY2FwIHBvbGxpbmcgYXQgfjEwIG1pbnV0ZXNcbiAgICAgICAgLy8gZXZlbiBpZiB0aGUgd29ya2VyIHNpbGVudGx5IGRpZXMsIGluc3RlYWQgb2Ygc3Bpbm5pbmcgZm9yZXZlci5cbiAgICAgICAgaW5zdGFsbFBvbGxzOiB7fSxcbiAgICB9LFxuXG4gICAgLy8gVm9pY2UgaW5zdGFsbCBwb2xsaW5nOiAzLXNlY29uZCB0aWNrIMOXIDUwMCBhdHRlbXB0cyDiiYggMjUgbWludXRlcy5cbiAgICAvLyBUaGUgZGV0YWNoZWQgYGluc3RhbGwtdm9pY2UucGhwYCBydW5uZXIgdXNlcyBgY3VybCAtLW1heC10aW1lIDYwMGBcbiAgICAvLyBwZXIgYXNzZXQgKMOXMiBmaWxlcyA9IDIwLW1pbnV0ZSBoYXJkIGJhY2tlbmQgY2VpbGluZykuIFRoZSBwb2xsIGNhcFxuICAgIC8vIG11c3Qgc2l0IEFCT1ZFIHRoYXQgY2VpbGluZyDigJQgb3RoZXJ3aXNlIGEgc2xvdy1idXQtc3RpbGwtcnVubmluZ1xuICAgIC8vIGRvd25sb2FkIGlzIG1pc3Rha2VuIGZvciBhIGNyYXNoLCB0aGUgSlMgYmFpbHMsIGFuZCB0aGUgdXNlciBpcyBsZWZ0XG4gICAgLy8gd2l0aCBhIHN0dWNrIFVJIGV2ZW4gdGhvdWdoIHRoZSB3b3JrZXIgaXMgc3RpbGwgd3JpdGluZyB0aGUgZmlsZS5cbiAgICAvLyBCZXlvbmQgMjUgbWludXRlcyB3ZSBoYW5kIHJlY292ZXJ5IG9mZiB0byB0aGUgc2VydmVyLXNpZGUgc3dlZXBlclxuICAgIC8vICgzMCBtaW4sIEdldExpc3RBY3Rpb246OnN3ZWVwU3RhbGVJbnN0YWxscyksIHdoaWNoIGZsaXBzIHRoZSByb3cgdG9cbiAgICAvLyBgZmFpbGVkYCBhbmQgdGhlIG5leHQgcmVmcmVzaCBzaG93cyB0aGUgc3RhbmRhcmQgUmV0cnkgYnV0dG9uLlxuICAgIElOU1RBTExfUE9MTF9JTlRFUlZBTF9NUzogMzAwMCxcbiAgICBJTlNUQUxMX1BPTExfTUFYX0FUVEVNUFRTOiA1MDAsXG5cbiAgICBpbml0aWFsaXplKCkge1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10YWItbWVudSAuaXRlbScpLnRhYigpO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1yZW1lbWJlci1jaGVja2JveCcpLmNoZWNrYm94KCk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXNhbXBsZS1yYXRlJykuZHJvcGRvd24oKTtcblxuICAgICAgICAvLyBNb2R1bGUgZGlzYWJsZWQg4oaSIHBhZ2UgaXMgcmVhZC1vbmx5LCBza2lwIFJFU1QgcG9sbGluZyBhbmRcbiAgICAgICAgLy8gZGlzYWJsZSB0aGUgZm9ybSBpbnB1dHMuIEF2b2lkcyB0aGUgXCJmYWlsZWQgdG8gbG9hZCB2b2ljZXNcIlxuICAgICAgICAvLyBlcnJvciBwb3B1cCB1c2VycyBnb3Qgd2hlbiBvcGVuaW5nIGEgZGlzYWJsZWQgbW9kdWxlJ3MgcGFnZS5cbiAgICAgICAgaWYgKCh3aW5kb3cucGhyYXNlU3R1ZGlvRGVmYXVsdHMgfHwge30pLmRpc2FibGVkKSB7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1nZW5lcmF0ZS1mb3JtIDppbnB1dCwnXG4gICAgICAgICAgICAgICAgKyAnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtYnV0dG9uJykucHJvcCgnZGlzYWJsZWQnLCB0cnVlKTtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS5vbignaW5wdXQnLCBwaHJhc2VTdHVkaW9JbmRleC51cGRhdGVDb3VudGVyKTtcbiAgICAgICAgJCgnI3BocmFzZS1zdHVkaW8tZ2VuZXJhdGUtYnV0dG9uJykub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25HZW5lcmF0ZSk7XG4gICAgICAgICQoJ1tkYXRhLXRhYj1cInZvaWNlc1wiXScpLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMpO1xuICAgICAgICAkKCdbZGF0YS10YWI9XCJlbmdpbmVcIl0nKS5vbignY2xpY2snLCBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKTtcbiAgICAgICAgJCgnW2RhdGEtdGFiPVwiaGlzdG9yeVwiXScpLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hIaXN0b3J5KTtcblxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5hcHBseURlZmF1bHRzKCk7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hFbmdpbmUoKTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaFZvaWNlcygpO1xuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoSGlzdG9yeSgpO1xuICAgIH0sXG5cbiAgICBhcHBseURlZmF1bHRzKCkge1xuICAgICAgICBjb25zdCBkID0gd2luZG93LnBocmFzZVN0dWRpb0RlZmF1bHRzIHx8IHt9O1xuICAgICAgICBpZiAoZC5zYW1wbGVSYXRlKSB7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1zYW1wbGUtcmF0ZScpLmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCBkLnNhbXBsZVJhdGUpO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZUNvdW50ZXIoKSB7XG4gICAgICAgIGNvbnN0IHZhbHVlID0gJCgnI3BocmFzZS1zdHVkaW8tdGV4dCcpLnZhbCgpIHx8ICcnO1xuICAgICAgICBjb25zdCBtYXggICA9IHBhcnNlSW50KCQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS5hdHRyKCdtYXhsZW5ndGgnKSB8fCAnODAwJywgMTApO1xuICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0LWNvdW50ZXInKS50ZXh0KGAke3ZhbHVlLmxlbmd0aH0gLyAke21heH1gKTtcbiAgICB9LFxuXG4gICAgcmVmcmVzaEVuZ2luZSgpIHtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLmVuZ2luZSxcbiAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuZW5naW5lID0gKHJlc3BvbnNlICYmIHJlc3BvbnNlLmRhdGEpIHx8IG51bGw7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJFbmdpbmUoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yRW5naW5lU3RhdHVzKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIHJlbmRlckVuZ2luZSgpIHtcbiAgICAgICAgY29uc3QgJGJveCA9ICQoJyNwaHJhc2Utc3R1ZGlvLWVuZ2luZS1zdGF0dXMnKS5lbXB0eSgpO1xuICAgICAgICBjb25zdCBkYXRhID0gcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuZW5naW5lIHx8IHt9O1xuICAgICAgICBpZiAoZGF0YS5pbnN0YWxsZWQpIHtcbiAgICAgICAgICAgIC8vIE9uY2UgdGhlIGJpbmFyeSBpcyBvbiBkaXNrIHdlIG9mZmVyIFwiVXBkYXRlIGVuZ2luZVwiIGluc3RlYWQgb2ZcbiAgICAgICAgICAgIC8vIGFuIFVuaW5zdGFsbCDigJQgcmUtcnVubmluZyBpbnN0YWxsKCkgb3ZlcndyaXRlcyB0aGUgdGFyYmFsbCB3aXRoXG4gICAgICAgICAgICAvLyB0aGUgcGlubmVkIFJFTEVBU0VfVkVSU0lPTiAob3Igd2hhdGV2ZXIgdGhlIGNhdGFsb2cgbm93IHBvaW50c1xuICAgICAgICAgICAgLy8gYXQpLCBzbyB0aGUgc2FtZSBidXR0b24gZG91YmxlcyBhcyBhIHJlZnJlc2ggcGF0aC4gUmVtb3ZpbmcgdGhlXG4gICAgICAgICAgICAvLyBVbmluc3RhbGwgYnV0dG9uIGZyb20gdGhlIFVJIGlzIGludGVudGlvbmFsOiB1c2VycyB3YW50ZWQgYVxuICAgICAgICAgICAgLy8gcmVmcmVzaCwgbm90IGEgd2lwZTsgZnVsbCByZW1vdmFsIHN0aWxsIHdvcmtzIHZpYSBERUxFVEUgL2VuZ2luZVxuICAgICAgICAgICAgLy8gZm9yIGFueW9uZSBzY3JpcHRpbmcgYWdhaW5zdCB0aGUgQVBJLlxuICAgICAgICAgICAgJGJveC5hcHBlbmQoXG4gICAgICAgICAgICAgICAgJCgnPGRpdj4nKS5hZGRDbGFzcygndWkgcG9zaXRpdmUgbWVzc2FnZScpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJCgnPGRpdj4nKS5hZGRDbGFzcygnaGVhZGVyJykudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lSW5zdGFsbGVkKSlcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgkKCc8cD4nKS50ZXh0KGAke2dsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVWZXJzaW9ufTogJHtkYXRhLnZlcnNpb24gfHwgJ+KAlCd9YCkpXG4gICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoXG4gICAgICAgICAgICAgICAgICAgICAgICAkKCc8YnV0dG9uPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLmFkZENsYXNzKCd1aSBzbWFsbCBiYXNpYyBidXR0b24nKVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVVcGRhdGUpXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gVXBkYXRlIHBhdGggcG9zdHMge2ZvcmNlOiB0cnVlfSBzbyB0aGUgYWN0aW9uXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLy8gYnlwYXNzZXMgaXRzIGBpc0luc3RhbGxlZCgpYCBzaG9ydGN1dCBhbmQgYWN0dWFsbHlcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyByZS1kb3dubG9hZHMgdGhlIHBpbm5lZCBSRUxFQVNFX1ZFUlNJT04uIFdpdGhvdXRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAvLyB0aGUgZmxhZyB0aGUgY2xpY2sgd291bGQgYmUgYSBuby1vcCBvbmNlIHRoZVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIC8vIGVuZ2luZSBpcyBhbHJlYWR5IG9uIGRpc2suXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgLm9uKCdjbGljaycsIHBocmFzZVN0dWRpb0luZGV4Lm9uRW5naW5lVXBkYXRlKVxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgJGJveC5hcHBlbmQoXG4gICAgICAgICAgICAgICAgJCgnPGRpdj4nKS5hZGRDbGFzcygndWkgd2FybmluZyBtZXNzYWdlJylcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgkKCc8ZGl2PicpLmFkZENsYXNzKCdoZWFkZXInKS50ZXh0KGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FbmdpbmVOb3RJbnN0YWxsZWQpKVxuICAgICAgICAgICAgICAgICAgICAuYXBwZW5kKCQoJzxwPicpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0VuZ2luZUluc3RhbGxIaW50KSlcbiAgICAgICAgICAgICAgICAgICAgLmFwcGVuZChcbiAgICAgICAgICAgICAgICAgICAgICAgICQoJzxidXR0b24+JylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAuYWRkQ2xhc3MoJ3VpIHByaW1hcnkgYnV0dG9uJylcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAudGV4dChnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRW5naW5lSW5zdGFsbClcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25FbmdpbmVJbnN0YWxsKVxuICAgICAgICAgICAgICAgICAgICApXG4gICAgICAgICAgICApO1xuICAgICAgICB9XG4gICAgfSxcblxuICAgIG9uRW5naW5lSW5zdGFsbCgpIHtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguZGlzcGF0Y2hFbmdpbmVJbnN0YWxsKCQodGhpcyksIGZhbHNlKTtcbiAgICB9LFxuXG4gICAgb25FbmdpbmVVcGRhdGUoKSB7XG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LmRpc3BhdGNoRW5naW5lSW5zdGFsbCgkKHRoaXMpLCB0cnVlKTtcbiAgICB9LFxuXG4gICAgZGlzcGF0Y2hFbmdpbmVJbnN0YWxsKCRidG4sIGZvcmNlKSB7XG4gICAgICAgICRidG4uYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLmVuZ2luZUluc3RhbGwsXG4gICAgICAgICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgICAgICAgIC8vIFBPU1QgYm9keSBpcyByZXF1aXJlZCBmb3IgYGZvcmNlYCB0byBsYW5kIG9uIHRoZSBhY3Rpb24nc1xuICAgICAgICAgICAgLy8gJGRhdGEgYXJyYXk7IHRoZSBhY3Rpb24gcnVucyBgZmlsdGVyX3ZhciguLi4sIEZJTFRFUl9WQUxJREFURV9CT09MRUFOKWBcbiAgICAgICAgICAgIC8vIHNvIHRoZSBKU09OIGxpdGVyYWwgYHRydWVgIGFycml2ZXMgYXMgUEhQIHRydWUsIG5vdCBcIjFcIi5cbiAgICAgICAgICAgIGRhdGE6IEpTT04uc3RyaW5naWZ5KHtmb3JjZTogISFmb3JjZX0pLFxuICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZWZyZXNoRW5naW5lKCk7XG4gICAgICAgICAgICBpZiAocmVzcG9uc2UgJiYgcmVzcG9uc2UucmVzdWx0ID09PSBmYWxzZSkge1xuICAgICAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhyZXNwb25zZS5tZXNzYWdlcyk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgJGJ0bi5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckVuZ2luZUluc3RhbGwpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgLyoqIFN0YXNoIGZvciB0aGUgbW9zdCByZWNlbnQgaGlzdG9yeSBwYXlsb2FkIHNvIHdlIGNhbiByZS1yZW5kZXIgaXRcbiAgICAgKiAgb25jZSB0aGUgdm9pY2VzIGNhdGFsb2d1ZSBhcnJpdmVzIChyYWNlLWZpeDogcmVmcmVzaFZvaWNlcyBhbmRcbiAgICAgKiAgcmVmcmVzaEhpc3RvcnkgZmlyZSBpbiBwYXJhbGxlbCBvbiBpbml0OyB3aGVuIGhpc3Rvcnkgd2lucyBmaXJzdFxuICAgICAqICB0aGUgcm93cyByZW5kZXIgd2l0aCByYXcgdm9pY2VfaWRzIHVudGlsIHZvaWNlcyBjYXRjaCB1cCkuXG4gICAgICovXG4gICAgbGFzdEhpc3RvcnlSb3dzOiBbXSxcblxuICAgIHJlZnJlc2hWb2ljZXMoKSB7XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS52b2ljZXMsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnZvaWNlcyA9IChyZXNwb25zZSAmJiByZXNwb25zZS5kYXRhKSB8fCBbXTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlbmRlclZvaWNlc1RhYmxlKCk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJWb2ljZVBpY2tlcigpO1xuICAgICAgICAgICAgLy8gSWYgaGlzdG9yeSBhbHJlYWR5IHBhaW50ZWQgd2l0aCByYXcgdm9pY2VfaWRzIChwYXJhbGxlbCBpbml0XG4gICAgICAgICAgICAvLyByYWNlKSwgcmVwYWludCBub3cgdGhhdCB3ZSBoYXZlIHRoZSBjYXRhbG9ndWUgZm9yIGZsYWcgbG9va3VwLlxuICAgICAgICAgICAgaWYgKHBocmFzZVN0dWRpb0luZGV4Lmxhc3RIaXN0b3J5Um93cy5sZW5ndGggPiAwKSB7XG4gICAgICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVySGlzdG9yeShwaHJhc2VTdHVkaW9JbmRleC5sYXN0SGlzdG9yeVJvd3MpO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KS5mYWlsKCgpID0+IHtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZXNMaXN0KTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRyYW5zbGF0ZXMgYSBQaXBlciBsYW5ndWFnZSB0YWcgKGUuZy4gJ3J1LXJ1JywgJ2VuLXVzJywgJ3B0LWJyJylcbiAgICAgKiBpbnRvIGEgU2VtYW50aWMgVUkgZmxhZyBjbGFzcy4gVGhlIHNlY29uZCBzZWdtZW50IGlzIGFscmVhZHkgYW5cbiAgICAgKiBJU08gMzE2Ni0xIGFscGhhLTIgY291bnRyeSBjb2RlIGluIHRoZSBjYXRhbG9ndWUsIHNvIHdlIGp1c3RcbiAgICAgKiBleHRyYWN0IGFuZCBsb3dlcmNhc2UgaXQuIFVua25vd24gdGFncyBmYWxsIGJhY2sgdG8gbm8gZmxhZy5cbiAgICAgKi9cbiAgICBmbGFnQ2xhc3NGb3IobGFuZ3VhZ2UpIHtcbiAgICAgICAgaWYgKCFsYW5ndWFnZSkgcmV0dXJuICcnO1xuICAgICAgICBjb25zdCBwYXJ0cyA9IFN0cmluZyhsYW5ndWFnZSkudG9Mb3dlckNhc2UoKS5zcGxpdCgnLScpO1xuICAgICAgICBjb25zdCBjYyA9IHBhcnRzW3BhcnRzLmxlbmd0aCAtIDFdO1xuICAgICAgICBpZiAoIWNjIHx8IGNjLmxlbmd0aCAhPT0gMikgcmV0dXJuICcnO1xuICAgICAgICByZXR1cm4gY2M7XG4gICAgfSxcblxuICAgIHJlbmRlclZvaWNlc1RhYmxlKCkge1xuICAgICAgICBjb25zdCAkdGJvZHkgPSAkKCcjcGhyYXNlLXN0dWRpby12b2ljZXMtdGFibGUgdGJvZHknKS5lbXB0eSgpO1xuICAgICAgICBjb25zdCBpbnN0YWxsaW5nVm9pY2VJZHMgPSBbXTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzLmZvckVhY2goKHZvaWNlKSA9PiB7XG4gICAgICAgICAgICBjb25zdCAkcm93ID0gJCgnPHRyPicpLmF0dHIoJ2RhdGEtdm9pY2UnLCB2b2ljZS52b2ljZV9pZCk7XG4gICAgICAgICAgICBjb25zdCBmbGFnID0gcGhyYXNlU3R1ZGlvSW5kZXguZmxhZ0NsYXNzRm9yKHZvaWNlLmxhbmd1YWdlKTtcbiAgICAgICAgICAgIGNvbnN0ICRsYW5nID0gJCgnPHRkPicpO1xuICAgICAgICAgICAgaWYgKGZsYWcpIHtcbiAgICAgICAgICAgICAgICAkbGFuZy5hcHBlbmQoYDxpIGNsYXNzPVwiJHtmbGFnfSBmbGFnXCI+PC9pPmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJGxhbmcuYXBwZW5kKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGAke3ZvaWNlLmxhbmd1YWdlX2xhYmVsfSAoJHt2b2ljZS5sYW5ndWFnZX0pYCkpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJGxhbmcpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQodm9pY2Uudm9pY2VfbmFtZSkpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQodm9pY2UucXVhbGl0eSkpO1xuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJCgnPHRkPicpLnRleHQoYCR7dm9pY2Uuc2FtcGxlX3JhdGV9IEh6YCkpO1xuXG4gICAgICAgICAgICBjb25zdCBzdGF0dXMgPSB2b2ljZS5pbnN0YWxsX3N0YXR1cyB8fCAodm9pY2UuaW5zdGFsbGVkID8gJ2luc3RhbGxlZCcgOiAnJyk7XG4gICAgICAgICAgICBjb25zdCAkc3RhdHVzQ2VsbCA9ICQoJzx0ZD4nKTtcbiAgICAgICAgICAgIGlmIChzdGF0dXMgPT09ICdpbnN0YWxsZWQnKSB7XG4gICAgICAgICAgICAgICAgJHN0YXR1c0NlbGwuaHRtbChgPHNwYW4gY2xhc3M9XCJ1aSBncmVlbiBsYWJlbFwiPiR7Z2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbGVkfTwvc3Bhbj5gKTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RhdHVzID09PSAnaW5zdGFsbGluZycpIHtcbiAgICAgICAgICAgICAgICBpbnN0YWxsaW5nVm9pY2VJZHMucHVzaCh2b2ljZS52b2ljZV9pZCk7XG4gICAgICAgICAgICAgICAgJHN0YXR1c0NlbGwuaHRtbChcbiAgICAgICAgICAgICAgICAgICAgJzxkaXYgY2xhc3M9XCJ1aSBhY3RpdmUgaW5saW5lIG1pbmkgbG9hZGVyXCI+PC9kaXY+ICdcbiAgICAgICAgICAgICAgICAgICAgKyBgPHNwYW4gY2xhc3M9XCJ1aSB5ZWxsb3cgbGFiZWxcIj4ke2dsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZUluc3RhbGxpbmd9PC9zcGFuPmBcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChzdGF0dXMgPT09ICdmYWlsZWQnKSB7XG4gICAgICAgICAgICAgICAgY29uc3QgZXJyID0gdm9pY2UuaW5zdGFsbF9lcnJvciB8fCAnJztcbiAgICAgICAgICAgICAgICAkc3RhdHVzQ2VsbC5odG1sKFxuICAgICAgICAgICAgICAgICAgICBgPHNwYW4gY2xhc3M9XCJ1aSByZWQgbGFiZWxcIiB0aXRsZT1cIiR7JCgnPGRpdj4nKS50ZXh0KGVycikuaHRtbCgpfVwiPmBcbiAgICAgICAgICAgICAgICAgICAgKyBgJHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VGYWlsZWR9PC9zcGFuPmBcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICAkc3RhdHVzQ2VsbC5odG1sKGA8c3BhbiBjbGFzcz1cInVpIGxhYmVsXCI+JHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVm9pY2VOb3RJbnN0YWxsZWR9PC9zcGFuPmApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgJHJvdy5hcHBlbmQoJHN0YXR1c0NlbGwpO1xuXG4gICAgICAgICAgICBjb25zdCAkYWN0aW9ucyA9ICQoJzx0ZD4nKS5hZGRDbGFzcygncmlnaHQgYWxpZ25lZCcpO1xuICAgICAgICAgICAgaWYgKHN0YXR1cyA9PT0gJ2luc3RhbGxlZCcpIHtcbiAgICAgICAgICAgICAgICAkYWN0aW9ucy5hcHBlbmQoXG4gICAgICAgICAgICAgICAgICAgICQoJzxidXR0b24+JykuYWRkQ2xhc3MoJ3VpIHNtYWxsIGJhc2ljIHJlZCBpY29uIGJ1dHRvbicpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cignZGF0YS12b2ljZScsIHZvaWNlLnZvaWNlX2lkKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ3RpdGxlJywgZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlRGVsZXRlKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgnPGkgY2xhc3M9XCJ0cmFzaCBpY29uXCI+PC9pPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25Wb2ljZVVuaW5zdGFsbClcbiAgICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChzdGF0dXMgPT09ICdpbnN0YWxsaW5nJykge1xuICAgICAgICAgICAgICAgIC8vIFdoaWxlIHRoZSB3b3JrZXIgaXMgZG93bmxvYWRpbmcgd2UgbG9jayB0aGUgYWN0aW9uIGNlbGwg4oCUXG4gICAgICAgICAgICAgICAgLy8gc2hvd2luZyBhIGRpc2FibGVkIHNwaW5uZXIgbWFrZXMgdGhlIGluLWZsaWdodCBzdGF0ZSByZWFkXG4gICAgICAgICAgICAgICAgLy8gY2xlYXJseSBhbmQgcHJldmVudHMgZG91YmxlLXB1Ymxpc2ggb24gaW1wYXRpZW50IGNsaWNrcy5cbiAgICAgICAgICAgICAgICAkYWN0aW9ucy5hcHBlbmQoXG4gICAgICAgICAgICAgICAgICAgICQoJzxidXR0b24+JykuYWRkQ2xhc3MoJ3VpIHNtYWxsIHByaW1hcnkgaWNvbiBidXR0b24gbG9hZGluZyBkaXNhYmxlZCcpXG4gICAgICAgICAgICAgICAgICAgICAgICAuYXR0cignZGF0YS12b2ljZScsIHZvaWNlLnZvaWNlX2lkKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ3RpdGxlJywgZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbGluZylcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hcHBlbmQoJzxpIGNsYXNzPVwiZG93bmxvYWQgaWNvblwiPjwvaT4nKVxuICAgICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgIC8vICdmYWlsZWQnIGFuZCBub3QtaW5zdGFsbGVkIHNoYXJlIHRoZSBzYW1lIGFjdGlvbiBidXR0b24g4oCUXG4gICAgICAgICAgICAgICAgLy8gYm90aCByZXN1bHQgaW4gcHVibGlzaGluZyBhIGZyZXNoIGluc3RhbGxfdm9pY2Ugam9iLlxuICAgICAgICAgICAgICAgIGNvbnN0IGxhYmVsID0gc3RhdHVzID09PSAnZmFpbGVkJ1xuICAgICAgICAgICAgICAgICAgICA/IGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Wb2ljZVJldHJ5XG4gICAgICAgICAgICAgICAgICAgIDogZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbDtcbiAgICAgICAgICAgICAgICAkYWN0aW9ucy5hcHBlbmQoXG4gICAgICAgICAgICAgICAgICAgICQoJzxidXR0b24+JykuYWRkQ2xhc3MoJ3VpIHNtYWxsIHByaW1hcnkgaWNvbiBidXR0b24nKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmF0dHIoJ2RhdGEtdm9pY2UnLCB2b2ljZS52b2ljZV9pZClcbiAgICAgICAgICAgICAgICAgICAgICAgIC5hdHRyKCd0aXRsZScsIGxhYmVsKVxuICAgICAgICAgICAgICAgICAgICAgICAgLmFwcGVuZCgnPGkgY2xhc3M9XCJkb3dubG9hZCBpY29uXCI+PC9pPicpXG4gICAgICAgICAgICAgICAgICAgICAgICAub24oJ2NsaWNrJywgcGhyYXNlU3R1ZGlvSW5kZXgub25Wb2ljZUluc3RhbGwpXG4gICAgICAgICAgICAgICAgKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICRyb3cuYXBwZW5kKCRhY3Rpb25zKTtcbiAgICAgICAgICAgICR0Ym9keS5hcHBlbmQoJHJvdyk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIElmIHRoZSBwYWdlIG9wZW5lZCBtaWQtaW5zdGFsbCwgcmUtYXJtIGJvdW5kZWQgcG9sbGluZyBmb3IgdGhvc2VcbiAgICAgICAgLy8gcm93cyBzbyB0aGUgc3Bpbm5lciByZXNvbHZlcyB3aGVuIHRoZSBkZXRhY2hlZCB3b3JrZXIgZmluaXNoZXMuXG4gICAgICAgIGluc3RhbGxpbmdWb2ljZUlkcy5mb3JFYWNoKCh2b2ljZUlkKSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zY2hlZHVsZUluc3RhbGxQb2xsKHZvaWNlSWQpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcmVuZGVyVm9pY2VQaWNrZXIoKSB7XG4gICAgICAgIGNvbnN0ICRzZWxlY3QgPSAkKCcjcGhyYXNlLXN0dWRpby12b2ljZScpO1xuICAgICAgICBjb25zdCBwcmV2aW91cyA9ICRzZWxlY3QudmFsKCk7XG4gICAgICAgIGNvbnN0IGZhbGxiYWNrID0gKHdpbmRvdy5waHJhc2VTdHVkaW9EZWZhdWx0cyB8fCB7fSkudm9pY2UgfHwgJyc7XG4gICAgICAgICRzZWxlY3QuZW1wdHkoKTtcbiAgICAgICAgY29uc3QgaW5zdGFsbGVkID0gcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzLmZpbHRlcigodikgPT4gdi5pbnN0YWxsZWQpO1xuICAgICAgICBpZiAoaW5zdGFsbGVkLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgJHNlbGVjdC5hcHBlbmQoJCgnPG9wdGlvbj4nKS52YWwoJycpLnRleHQoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1BpY2tlckVtcHR5KSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBpbnN0YWxsZWQuZm9yRWFjaCgodm9pY2UpID0+IHtcbiAgICAgICAgICAgICAgICBjb25zdCBmbGFnID0gcGhyYXNlU3R1ZGlvSW5kZXguZmxhZ0NsYXNzRm9yKHZvaWNlLmxhbmd1YWdlKTtcbiAgICAgICAgICAgICAgICAvLyBTZW1hbnRpYyBVSSBkcm9wZG93biByZWFkcyBgZGF0YS10ZXh0YCBmb3IgdGhlIGRpc3BsYXkgc3RyaW5nXG4gICAgICAgICAgICAgICAgLy8gYW5kIHJlbmRlcnMgYSBmbGFnIGZyb20gYGRhdGEtZmxhZ2Agd2hlbiBwcmVzZW50LCBzbyB0aGUgY2hvc2VuXG4gICAgICAgICAgICAgICAgLy8gb3B0aW9uIGtlZXBzIHRoZSBpY29uIGFmdGVyIHNlbGVjdGlvbi5cbiAgICAgICAgICAgICAgICBjb25zdCAkb3B0ID0gJCgnPG9wdGlvbj4nKVxuICAgICAgICAgICAgICAgICAgICAudmFsKHZvaWNlLnZvaWNlX2lkKVxuICAgICAgICAgICAgICAgICAgICAudGV4dChgJHt2b2ljZS5sYW5ndWFnZV9sYWJlbH0g4oCUICR7dm9pY2Uudm9pY2VfbmFtZX0gKCR7dm9pY2UucXVhbGl0eX0pYCk7XG4gICAgICAgICAgICAgICAgaWYgKGZsYWcpIHtcbiAgICAgICAgICAgICAgICAgICAgJG9wdC5hdHRyKCdkYXRhLWZsYWcnLCBmbGFnKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgJHNlbGVjdC5hcHBlbmQoJG9wdCk7XG4gICAgICAgICAgICB9KTtcbiAgICAgICAgfVxuICAgICAgICAkc2VsZWN0LmRyb3Bkb3duKHtmdWxsVGV4dFNlYXJjaDogdHJ1ZX0pO1xuICAgICAgICBjb25zdCB3YW50ID0gcHJldmlvdXMgfHwgZmFsbGJhY2s7XG4gICAgICAgIGlmICh3YW50KSB7XG4gICAgICAgICAgICAkc2VsZWN0LmRyb3Bkb3duKCdzZXQgc2VsZWN0ZWQnLCB3YW50KTtcbiAgICAgICAgfVxuICAgIH0sXG5cbiAgICBvblZvaWNlSW5zdGFsbCgpIHtcbiAgICAgICAgY29uc3QgJGJ0biA9ICQodGhpcyk7XG4gICAgICAgIGNvbnN0IHZvaWNlSWQgPSAkYnRuLmRhdGEoJ3ZvaWNlJyk7XG4gICAgICAgIC8vIExvY2sgdGhlIGJ1dHRvbiBpbW1lZGlhdGVseSBzbyBpbXBhdGllbnQgZG91YmxlLWNsaWNrcyBjYW4ndCBxdWV1ZVxuICAgICAgICAvLyBhIGR1cGxpY2F0ZSBpbnN0YWxsLiBUaGUgYnV0dG9uIHN0YXlzIGRpc2FibGVkIHVudGlsIHJlZnJlc2hWb2ljZXNcbiAgICAgICAgLy8gcmUtcmVuZGVycyB0aGUgcm93IGZyb20gdGhlIG5ldyBpbnN0YWxsX3N0YXR1cy5cbiAgICAgICAgJGJ0bi5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VJbnN0YWxsLFxuICAgICAgICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICAgICAgICBkYXRhOiBKU09OLnN0cmluZ2lmeSh7dm9pY2VfaWQ6IHZvaWNlSWR9KSxcbiAgICAgICAgICAgIGNvbnRlbnRUeXBlOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgaWYgKHJlc3BvbnNlICYmIHJlc3BvbnNlLnJlc3VsdCA9PT0gZmFsc2UpIHtcbiAgICAgICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKHJlc3BvbnNlLm1lc3NhZ2VzXG4gICAgICAgICAgICAgICAgICAgIHx8IGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvclZvaWNlSW5zdGFsbCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgLy8gQmFja2VuZCByZXR1cm5zIDIwMiB3aXRoIGluc3RhbGxfc3RhdHVzPSdpbnN0YWxsaW5nJyBiZWZvcmUgdGhlXG4gICAgICAgICAgICAvLyB3b3JrZXIgYWN0dWFsbHkgcnVucyBjdXJsLiBUaGUgcm93IHNwaW5uZXIgKyBcIkRvd25sb2FkaW5n4oCmXCIgbGFiZWxcbiAgICAgICAgICAgIC8vIGFuZCB0aGUgZGlzYWJsZWQgYWN0aW9uIGJ1dHRvbiBhbHJlYWR5IGNvbnZleSB0aGUgaW4tZmxpZ2h0IHN0YXRlXG4gICAgICAgICAgICAvLyDigJQgbm8gdG9hc3QgbmVlZGVkLlxuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaFZvaWNlcygpO1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc2NoZWR1bGVJbnN0YWxsUG9sbCh2b2ljZUlkKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VJbnN0YWxsKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFBvbGxzIEdFVCAvdm9pY2VzIGZvciB0aGUgZ2l2ZW4gdm9pY2VfaWQgdW50aWwgaW5zdGFsbF9zdGF0dXMgZmxpcHNcbiAgICAgKiBvdXQgb2YgJ2luc3RhbGxpbmcnLiBSZS1lbnRyYW50OiBzY2hlZHVsaW5nIHRoZSBzYW1lIHZvaWNlIHdoaWxlIGFcbiAgICAgKiB0aW1lciBpcyBhbHJlYWR5IHBlbmRpbmcgaXMgYSBuby1vcCAoY292ZXJzIGRvdWJsZS1yZW5kZXJzIHRyaWdnZXJlZFxuICAgICAqIGJ5IHRhYiBzd2l0Y2hlcyBhbmQgY29uY3VycmVudCByZWZyZXNoVm9pY2VzIGNhbGxzKS5cbiAgICAgKi9cbiAgICBzY2hlZHVsZUluc3RhbGxQb2xsKHZvaWNlSWQpIHtcbiAgICAgICAgY29uc3QgcG9sbHMgPSBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5pbnN0YWxsUG9sbHM7XG4gICAgICAgIGlmIChwb2xsc1t2b2ljZUlkXSkgcmV0dXJuO1xuICAgICAgICBwb2xsc1t2b2ljZUlkXSA9IHtzdGFydGVkQXQ6IERhdGUubm93KCksIGF0dGVtcHRzOiAwfTtcbiAgICAgICAgcG9sbHNbdm9pY2VJZF0udGltZXIgPSBzZXRJbnRlcnZhbChcbiAgICAgICAgICAgICgpID0+IHBocmFzZVN0dWRpb0luZGV4LnRpY2tJbnN0YWxsUG9sbCh2b2ljZUlkKSxcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LklOU1RBTExfUE9MTF9JTlRFUlZBTF9NU1xuICAgICAgICApO1xuICAgIH0sXG5cbiAgICBjYW5jZWxJbnN0YWxsUG9sbCh2b2ljZUlkKSB7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0gcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaW5zdGFsbFBvbGxzW3ZvaWNlSWRdO1xuICAgICAgICBpZiAoIWVudHJ5KSByZXR1cm47XG4gICAgICAgIGNsZWFySW50ZXJ2YWwoZW50cnkudGltZXIpO1xuICAgICAgICBkZWxldGUgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaW5zdGFsbFBvbGxzW3ZvaWNlSWRdO1xuICAgIH0sXG5cbiAgICB0aWNrSW5zdGFsbFBvbGwodm9pY2VJZCkge1xuICAgICAgICBjb25zdCBlbnRyeSA9IHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLmluc3RhbGxQb2xsc1t2b2ljZUlkXTtcbiAgICAgICAgaWYgKCFlbnRyeSkgcmV0dXJuO1xuICAgICAgICBlbnRyeS5hdHRlbXB0cyArPSAxO1xuICAgICAgICBpZiAoZW50cnkuYXR0ZW1wdHMgPiBwaHJhc2VTdHVkaW9JbmRleC5JTlNUQUxMX1BPTExfTUFYX0FUVEVNUFRTKSB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5jYW5jZWxJbnN0YWxsUG9sbCh2b2ljZUlkKTtcbiAgICAgICAgICAgIC8vIFdlIGRlbGliZXJhdGVseSBkbyBOT1QgREVMRVRFIHRoZSByb3cgaGVyZTogdGhlIGNhcCBpcyBzZXRcbiAgICAgICAgICAgIC8vIGFib3ZlIHRoZSBiYWNrZW5kJ3Mgd29yc3QtY2FzZSBjdXJsIHdpbmRvdywgYnV0IGEgZ2VudWluZWx5XG4gICAgICAgICAgICAvLyBzbG93IGluc3RhbGwgY2FuIHN0aWxsIGJlIHdyaXRpbmcgZmlsZXMuIFlhbmtpbmcgdGhlIHJvd1xuICAgICAgICAgICAgLy8gd291bGQgcmFjZSB3aXRoIHRoZSB3b3JrZXIncyBmaW5hbCBzYXZlIChvcnBoYW4gLm9ubngpIGFuZFxuICAgICAgICAgICAgLy8gZXJhc2UgYSByZWFsIHN1Y2Nlc3MgYSBmZXcgc2Vjb25kcyBiZWZvcmUgaXQgbGFuZHMuIEp1c3RcbiAgICAgICAgICAgIC8vIHN1cmZhY2UgYSBoaW50IGFuZCBsZXQgdGhlIHNlcnZlci1zaWRlIHN3ZWVwZXIgKDMwIG1pbixcbiAgICAgICAgICAgIC8vIEdldExpc3RBY3Rpb246OnN3ZWVwU3RhbGVJbnN0YWxscykgZmxpcCB0aGUgcm93IHRvIGBmYWlsZWRgXG4gICAgICAgICAgICAvLyBpZiB0aGUgZG93bmxvYWQgYWN0dWFsbHkgZGllZCDigJQgdGhlIFVJIHRoZW4gc2hvd3MgUmV0cnkuXG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX1ZvaWNlSW5zdGFsbFRpbWVvdXQpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICB1cmw6IHBocmFzZVN0dWRpb0luZGV4LmFwaS52b2ljZXMsXG4gICAgICAgICAgICBtZXRob2Q6ICdHRVQnLFxuICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgfSkuZG9uZSgocmVzcG9uc2UpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IGxpc3QgPSAocmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YSkgfHwgW107XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS52b2ljZXMgPSBsaXN0O1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVuZGVyVm9pY2VzVGFibGUoKTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlbmRlclZvaWNlUGlja2VyKCk7XG4gICAgICAgICAgICBjb25zdCB2b2ljZSA9IGxpc3QuZmluZCgodikgPT4gdi52b2ljZV9pZCA9PT0gdm9pY2VJZCk7XG4gICAgICAgICAgICBpZiAoIXZvaWNlKSB7XG4gICAgICAgICAgICAgICAgLy8gUm93IHZhbmlzaGVkICh1c2VyIHByZXNzZWQgUmVtb3ZlIG1pZC1pbnN0YWxsKTogZHJvcCB0aGUgdGltZXIuXG4gICAgICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguY2FuY2VsSW5zdGFsbFBvbGwodm9pY2VJZCk7XG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHZvaWNlLmluc3RhbGxfc3RhdHVzID09PSAnaW5zdGFsbGVkJykge1xuICAgICAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LmNhbmNlbEluc3RhbGxQb2xsKHZvaWNlSWQpO1xuICAgICAgICAgICAgICAgIC8vIE5vIHRvYXN0IOKAlCB0aGUgcm93IGFscmVhZHkgdHVybmVkIGdyZWVuIHdpdGggdGhlIG5ldyBzdGF0dXNcbiAgICAgICAgICAgICAgICAvLyBhbmQgdGhlIGFjdGlvbiBidXR0b24gYmVjYW1lIFJlbW92ZS4gRmFpbHVyZXMgc3RpbGwgdG9hc3QsXG4gICAgICAgICAgICAgICAgLy8gYmVjYXVzZSBpbnN0YWxsX2Vycm9yIG5lZWRzIHN1cmZhY2luZyBzb21ld2hlcmUuXG4gICAgICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHZvaWNlLmluc3RhbGxfc3RhdHVzID09PSAnZmFpbGVkJykge1xuICAgICAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LmNhbmNlbEluc3RhbGxQb2xsKHZvaWNlSWQpO1xuICAgICAgICAgICAgICAgIGNvbnN0IGRldGFpbCA9IHZvaWNlLmluc3RhbGxfZXJyb3JcbiAgICAgICAgICAgICAgICAgICAgPyBgJHtnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fRXJyb3JWb2ljZUluc3RhbGx9ICR7dm9pY2UuaW5zdGFsbF9lcnJvcn1gXG4gICAgICAgICAgICAgICAgICAgIDogZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VJbnN0YWxsO1xuICAgICAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhkZXRhaWwpO1xuICAgICAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIHN0YXR1cyA9PT0gJ2luc3RhbGxpbmcnIOKGkiBrZWVwIHRpY2tpbmdcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIG9uVm9pY2VVbmluc3RhbGwoKSB7XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKHRoaXMpO1xuICAgICAgICBjb25zdCB2b2ljZUlkID0gJGJ0bi5kYXRhKCd2b2ljZScpO1xuICAgICAgICAkYnRuLmFkZENsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgIC8vIENhbmNlbCBhbnkgaW4tZmxpZ2h0IGluc3RhbGwgcG9sbCBmb3IgdGhpcyB2b2ljZSDigJQgUmVtb3ZlIG9uIGFcbiAgICAgICAgLy8gJ2ZhaWxlZCcgb3IgJ2luc3RhbGxpbmcnIHJvdyBzaG91bGQgY2xlYXIgdGhlIHBsYWNlaG9sZGVyIGNsZWFubHkuXG4gICAgICAgIHBocmFzZVN0dWRpb0luZGV4LmNhbmNlbEluc3RhbGxQb2xsKHZvaWNlSWQpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBgJHtwaHJhc2VTdHVkaW9JbmRleC5hcGkudm9pY2VzfS8ke2VuY29kZVVSSUNvbXBvbmVudCh2b2ljZUlkKX1gLFxuICAgICAgICAgICAgbWV0aG9kOiAnREVMRVRFJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKCkgPT4ge1xuICAgICAgICAgICAgLy8gTm8gdG9hc3Qg4oCUIHRoZSByb3cgcmV2ZXJ0cyB0byB0aGUgbm90LWluc3RhbGxlZCBsYWJlbCBhbmQgc2hvd3NcbiAgICAgICAgICAgIC8vIGFuIEluc3RhbGwgYnV0dG9uLCB3aGljaCBpcyBlbm91Z2ggY29uZmlybWF0aW9uIGZvciBhIGRlbGV0ZS5cbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnJlZnJlc2hWb2ljZXMoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yVm9pY2VVbmluc3RhbGwpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgb25HZW5lcmF0ZSgpIHtcbiAgICAgICAgY29uc3QgdGV4dCAgICAgICA9ICgkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykudmFsKCkgfHwgJycpLnRyaW0oKTtcbiAgICAgICAgY29uc3Qgdm9pY2VJZCAgICA9ICQoJyNwaHJhc2Utc3R1ZGlvLXZvaWNlJykudmFsKCkgfHwgJyc7XG4gICAgICAgIGNvbnN0IHNhbXBsZVJhdGUgPSAkKCcjcGhyYXNlLXN0dWRpby1zYW1wbGUtcmF0ZScpLnZhbCgpIHx8ICduYXRpdmUnO1xuICAgICAgICBpZiAoIXRleHQgfHwgIXZvaWNlSWQpIHtcbiAgICAgICAgICAgIFVzZXJNZXNzYWdlLnNob3dNdWx0aVN0cmluZyhnbG9iYWxUcmFuc2xhdGUubW9kdWxlX3BocmFzZV9zdHVkaW9fVmFsaWRhdGlvbk1pc3NpbmcpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIGNvbnN0ICRidG4gPSAkKCcjcGhyYXNlLXN0dWRpby1nZW5lcmF0ZS1idXR0b24nKS5hZGRDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlcyxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YTogSlNPTi5zdHJpbmdpZnkoe3RleHQsIHZvaWNlX2lkOiB2b2ljZUlkLCBzYW1wbGVfcmF0ZTogc2FtcGxlUmF0ZX0pLFxuICAgICAgICAgICAgY29udGVudFR5cGU6ICdhcHBsaWNhdGlvbi9qc29uJyxcbiAgICAgICAgICAgIGRhdGFUeXBlOiAnanNvbicsXG4gICAgICAgIH0pLmRvbmUoKHJlc3BvbnNlKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBjb25zdCBkYXRhID0gcmVzcG9uc2UgJiYgcmVzcG9uc2UuZGF0YTtcbiAgICAgICAgICAgIGlmICghZGF0YSB8fCAhZGF0YS5waHJhc2VfaWQpIHtcbiAgICAgICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcocmVzcG9uc2UgJiYgcmVzcG9uc2UubWVzc2FnZXNcbiAgICAgICAgICAgICAgICAgICAgPyByZXNwb25zZS5tZXNzYWdlc1xuICAgICAgICAgICAgICAgICAgICA6IGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckdlbmVyYXRlKTtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoJCgnI3BocmFzZS1zdHVkaW8tcmVtZW1iZXInKS5pcygnOmNoZWNrZWQnKSkge1xuICAgICAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4LnBlcnNpc3REZWZhdWx0cyh2b2ljZUlkLCBzYW1wbGVSYXRlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIC8vIEhpc3RvcnkgdGFibGUgbGl2ZXMgcmlnaHQgdW5kZXIgdGhlIGZvcm0gb24gdGhlIFN0dWRpbyB0YWIsXG4gICAgICAgICAgICAvLyBzbyBhIHJlZnJlc2ggaXMgZW5vdWdoIOKAlCBubyB0YWIgc3dpdGNoLlxuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKTtcbiAgICAgICAgfSkuZmFpbCgoKSA9PiB7XG4gICAgICAgICAgICAkYnRuLnJlbW92ZUNsYXNzKCdsb2FkaW5nIGRpc2FibGVkJyk7XG4gICAgICAgICAgICBVc2VyTWVzc2FnZS5zaG93TXVsdGlTdHJpbmcoZ2xvYmFsVHJhbnNsYXRlLm1vZHVsZV9waHJhc2Vfc3R1ZGlvX0Vycm9yR2VuZXJhdGUpO1xuICAgICAgICB9KTtcbiAgICB9LFxuXG4gICAgcGVyc2lzdERlZmF1bHRzKHZvaWNlSWQsIHNhbXBsZVJhdGUpIHtcbiAgICAgICAgJC5hamF4KHtcbiAgICAgICAgICAgIHVybDogcGhyYXNlU3R1ZGlvSW5kZXguYXBpLnNhdmVEZWZhdWx0cyxcbiAgICAgICAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgICAgICAgZGF0YToge2RlZmF1bHRfdm9pY2U6IHZvaWNlSWQsIGRlZmF1bHRfc2FtcGxlX3JhdGU6IHNhbXBsZVJhdGV9LFxuICAgICAgICB9KS5kb25lKCgpID0+IHtcbiAgICAgICAgICAgIHdpbmRvdy5waHJhc2VTdHVkaW9EZWZhdWx0cyA9IHt2b2ljZTogdm9pY2VJZCwgc2FtcGxlUmF0ZX07XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZWZyZXNoSGlzdG9yeShjYWxsYmFjaykge1xuICAgICAgICAkLmFqYXgoe1xuICAgICAgICAgICAgdXJsOiBwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlcyxcbiAgICAgICAgICAgIG1ldGhvZDogJ0dFVCcsXG4gICAgICAgICAgICBkYXRhVHlwZTogJ2pzb24nLFxuICAgICAgICB9KS5kb25lKChyZXNwb25zZSkgPT4ge1xuICAgICAgICAgICAgY29uc3Qgcm93cyA9IChyZXNwb25zZSAmJiByZXNwb25zZS5kYXRhKSB8fCBbXTtcbiAgICAgICAgICAgIHBocmFzZVN0dWRpb0luZGV4Lmxhc3RIaXN0b3J5Um93cyA9IHJvd3M7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5yZW5kZXJIaXN0b3J5KHJvd3MpO1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgICAgIGNhbGxiYWNrKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgIH0sXG5cbiAgICByZW5kZXJIaXN0b3J5KHJvd3MpIHtcbiAgICAgICAgLy8gVGVhciBkb3duIERhdGFUYWJsZSArIHNvdW5kIHBsYXllcnMgZnJvbSB0aGUgcHJldmlvdXMgcmVuZGVyLlxuICAgICAgICBpZiAocGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaGlzdG9yeURhdGFUYWJsZVxuICAgICAgICAgICAgJiYgJC5mbi5EYXRhVGFibGUuaXNEYXRhVGFibGUoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKSkge1xuICAgICAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuaGlzdG9yeURhdGFUYWJsZS5kZXN0cm95KCk7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgICBPYmplY3QudmFsdWVzKHBocmFzZVN0dWRpb0luZGV4LnN0YXRlLnNvdW5kUGxheWVycykuZm9yRWFjaCgocCkgPT4ge1xuICAgICAgICAgICAgaWYgKHAgJiYgcC5odG1sNUF1ZGlvKSB7XG4gICAgICAgICAgICAgICAgcC5odG1sNUF1ZGlvLnBhdXNlKCk7XG4gICAgICAgICAgICAgICAgcC5odG1sNUF1ZGlvLnNyYyA9ICcnO1xuICAgICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUuc291bmRQbGF5ZXJzID0ge307XG5cbiAgICAgICAgY29uc3QgJHRib2R5ID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZSB0Ym9keScpLmVtcHR5KCk7XG4gICAgICAgIHJvd3MuZm9yRWFjaCgocm93KSA9PiB7XG4gICAgICAgICAgICAkdGJvZHkuYXBwZW5kKHBocmFzZVN0dWRpb0luZGV4LnJlbmRlckhpc3RvcnlSb3cocm93KSk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGNvbnN0ICR0YWJsZVdyYXAgPSAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJykuY2xvc2VzdCgnLmRhdGFUYWJsZXNfd3JhcHBlcicpO1xuICAgICAgICBpZiAocm93cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5oaWRlKCk7XG4gICAgICAgICAgICAoJHRhYmxlV3JhcC5sZW5ndGggPyAkdGFibGVXcmFwIDogJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpKS5oaWRlKCk7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LWVtcHR5Jykuc2hvdygpO1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktZW1wdHknKS5oaWRlKCk7XG4gICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5zaG93KCk7XG4gICAgICAgIGlmICgkdGFibGVXcmFwLmxlbmd0aCkge1xuICAgICAgICAgICAgJHRhYmxlV3JhcC5zaG93KCk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBJbml0aWFsaXNlIERhdGFUYWJsZSArIHNvdW5kIHBsYXllcnMsIG1pcnJvcmluZyBTb3VuZEZpbGVzIGluZGV4LlxuICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5oaXN0b3J5RGF0YVRhYmxlID0gJCgnI3BocmFzZS1zdHVkaW8taGlzdG9yeS10YWJsZScpLkRhdGFUYWJsZSh7XG4gICAgICAgICAgICBsZW5ndGhDaGFuZ2U6IGZhbHNlLFxuICAgICAgICAgICAgcGFnaW5nOiB0cnVlLFxuICAgICAgICAgICAgcGFnZUxlbmd0aDogMjUsXG4gICAgICAgICAgICBzZWFyY2hpbmc6IHRydWUsXG4gICAgICAgICAgICBpbmZvOiBmYWxzZSxcbiAgICAgICAgICAgIG9yZGVyaW5nOiB0cnVlLFxuICAgICAgICAgICAgbGFuZ3VhZ2U6IHR5cGVvZiBTZW1hbnRpY0xvY2FsaXphdGlvbiAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgICAgICAgICAgICA/IFNlbWFudGljTG9jYWxpemF0aW9uLmRhdGFUYWJsZUxvY2FsaXNhdGlvblxuICAgICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgICAgICAgb3JkZXI6IFtbMCwgJ2Rlc2MnXV0sXG4gICAgICAgIH0pO1xuXG4gICAgICAgIHJvd3MuZm9yRWFjaCgocm93KSA9PiB7XG4gICAgICAgICAgICBwaHJhc2VTdHVkaW9JbmRleC5zdGF0ZS5zb3VuZFBsYXllcnNbcm93LmlkXSA9XG4gICAgICAgICAgICAgICAgbmV3IEluZGV4U291bmRQbGF5ZXIoYHBocmFzZS1yb3ctJHtyb3cuaWR9YCk7XG4gICAgICAgIH0pO1xuXG4gICAgICAgIC8vIFN0YW5kYXJkIE1pa29QQlggdHdvLXN0ZXAgZGVsZXRlIChkZWxldGUtc29tZXRoaW5nLmpzKSBmbGlwcyB0aGVcbiAgICAgICAgLy8gJ3R3by1zdGVwcy1kZWxldGUnIGNsYXNzIG9mZiBvbiB0aGUgZmlyc3QgY2xpY2suIFdlIGxpc3RlbiBmb3IgdGhlXG4gICAgICAgIC8vICpzZWNvbmQqIGNsaWNrICh3aGVuIHRoZSBjbGFzcyBpcyBnb25lKSB0byBmaXJlIHRoZSBSRVNUIERFTEVURS5cbiAgICAgICAgJCgnYm9keScpLm9mZignY2xpY2sucGhyYXNlU3R1ZGlvJyk7XG4gICAgICAgICQoJ2JvZHknKS5vbignY2xpY2sucGhyYXNlU3R1ZGlvJywgJ2EuZGVsZXRlOm5vdCgudHdvLXN0ZXBzLWRlbGV0ZSknLCBmdW5jdGlvbiBvbkNvbmZpcm1lZERlbGV0ZShlKSB7XG4gICAgICAgICAgICBjb25zdCAkdGFyZ2V0ID0gJChlLnRhcmdldCkuY2xvc2VzdCgnYS5kZWxldGUnKTtcbiAgICAgICAgICAgIGlmICgkdGFyZ2V0LmNsb3Nlc3QoJyNwaHJhc2Utc3R1ZGlvLWhpc3RvcnktdGFibGUnKS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBlLnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgICAgICBlLnN0b3BJbW1lZGlhdGVQcm9wYWdhdGlvbigpO1xuICAgICAgICAgICAgY29uc3QgaWQgPSAkdGFyZ2V0LmF0dHIoJ2RhdGEtdmFsdWUnKTtcbiAgICAgICAgICAgIGlmICghaWQpIHJldHVybjtcbiAgICAgICAgICAgICR0YXJnZXQuYWRkQ2xhc3MoJ2xvYWRpbmcgZGlzYWJsZWQnKTtcbiAgICAgICAgICAgICQuYWpheCh7XG4gICAgICAgICAgICAgICAgdXJsOiBgJHtwaHJhc2VTdHVkaW9JbmRleC5hcGkucGhyYXNlc30vJHtpZH1gLFxuICAgICAgICAgICAgICAgIG1ldGhvZDogJ0RFTEVURScsXG4gICAgICAgICAgICAgICAgZGF0YVR5cGU6ICdqc29uJyxcbiAgICAgICAgICAgIH0pLmRvbmUoKCkgPT4gcGhyYXNlU3R1ZGlvSW5kZXgucmVmcmVzaEhpc3RvcnkoKSlcbiAgICAgICAgICAgICAgLmZhaWwoKCkgPT4ge1xuICAgICAgICAgICAgICAgICAgJHRhcmdldC5yZW1vdmVDbGFzcygnbG9hZGluZyBkaXNhYmxlZCcpO1xuICAgICAgICAgICAgICAgICAgVXNlck1lc3NhZ2Uuc2hvd011bHRpU3RyaW5nKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19FcnJvckhpc3RvcnlEZWxldGUpO1xuICAgICAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnN0ICR0YmwgPSAkKCcjcGhyYXNlLXN0dWRpby1oaXN0b3J5LXRhYmxlJyk7XG4gICAgICAgICR0YmwuZmluZCgnLnBvcHVwZWQnKS5wb3B1cCgpO1xuICAgICAgICAvLyBDbGljayBvbiB0aGUgdGV4dCBjZWxsIOKGkiBjb3B5IHBocmFzZSB0ZXh0ICsgdm9pY2UgYmFjayBpbnRvIHRoZSBmb3JtXG4gICAgICAgIC8vIHNvIHRoZSB1c2VyIGNhbiBlZGl0IGFuZCByZS1nZW5lcmF0ZSB3aXRob3V0IHJldHlwaW5nLiBLZWVwcyB0aGVcbiAgICAgICAgLy8gcGxheWVyIC8gZG93bmxvYWQgLyBkZWxldGUgYnV0dG9ucyBjbGlja2FibGUgb24gdGhlaXIgb3duLlxuICAgICAgICAkdGJsLm9mZignY2xpY2sucGhyYXNlU3R1ZGlvJyk7XG4gICAgICAgICR0Ymwub24oJ2NsaWNrLnBocmFzZVN0dWRpbycsICd0ZC5waHJhc2UtcmV1c2UnLCBmdW5jdGlvbiBvblJldXNlKCkge1xuICAgICAgICAgICAgY29uc3QgJHJvdyA9ICQodGhpcykuY2xvc2VzdCgndHInKTtcbiAgICAgICAgICAgIGNvbnN0IHRleHQgPSAkcm93LmF0dHIoJ2RhdGEtdGV4dCcpIHx8ICcnO1xuICAgICAgICAgICAgY29uc3Qgdm9pY2UgPSAkcm93LmF0dHIoJ2RhdGEtdm9pY2UnKSB8fCAnJztcbiAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS52YWwodGV4dCkudHJpZ2dlcignaW5wdXQnKTtcbiAgICAgICAgICAgIGlmICh2b2ljZSkge1xuICAgICAgICAgICAgICAgICQoJyNwaHJhc2Utc3R1ZGlvLXZvaWNlJykuZHJvcGRvd24oJ3NldCBzZWxlY3RlZCcsIHZvaWNlKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgICQoJ2h0bWwsIGJvZHknKS5hbmltYXRlKHtzY3JvbGxUb3A6ICQoJyNwaHJhc2Utc3R1ZGlvLXRleHQnKS5vZmZzZXQoKS50b3AgLSA4MH0sIDIwMCk7XG4gICAgICAgICAgICAkKCcjcGhyYXNlLXN0dWRpby10ZXh0JykuZm9jdXMoKTtcbiAgICAgICAgfSk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFJlc29sdmVzIGEgcGhyYXNlIHJvdydzIHZvaWNlX2lkIGludG8gYSBcIvCfh7fwn4e6IElyaW5hIChtZWRpdW0pXCIgc3RyaW5nIHdpdGhcbiAgICAgKiB0aGUgbWF0Y2hpbmcgU2VtYW50aWMgVUkgZmxhZy4gRmFsbHMgYmFjayB0byB0aGUgcmF3IHZvaWNlX2lkIHdoZW4gdGhlXG4gICAgICogdm9pY2UgaXMgbm90IGluIHRoZSBsb2FkZWQgY2F0YWxvZ3VlIChlLmcuIHVzZXIgcmVtb3ZlZCB0aGUgdm9pY2UgYnV0XG4gICAgICogdGhlIHBocmFzZSByb3cgZnJvbSBiZWZvcmUgaXMgc3RpbGwgaW4gaGlzdG9yeSkuXG4gICAgICovXG4gICAgZm9ybWF0Vm9pY2VMYWJlbCh2b2ljZUlkKSB7XG4gICAgICAgIGNvbnN0IGVzY0F0dHIgPSAocykgPT4gJCgnPGRpdj4nKS50ZXh0KHMpLmh0bWwoKS5yZXBsYWNlKC9cIi9nLCAnJnF1b3Q7Jyk7XG4gICAgICAgIGlmICghdm9pY2VJZCkgcmV0dXJuICc8c3BhbiBjbGFzcz1cInVpIGxhYmVsXCI+4oCUPC9zcGFuPic7XG4gICAgICAgIGNvbnN0IHZvaWNlID0gcGhyYXNlU3R1ZGlvSW5kZXguc3RhdGUudm9pY2VzLmZpbmQoKHYpID0+IHYudm9pY2VfaWQgPT09IHZvaWNlSWQpO1xuICAgICAgICBpZiAoIXZvaWNlKSB7XG4gICAgICAgICAgICAvLyBWb2ljZSBubyBsb25nZXIgaW5zdGFsbGVkIOKAlCBrZWVwIHJhdyBpZCBzbyB0aGUgdXNlciBjYW5cbiAgICAgICAgICAgIC8vIGlkZW50aWZ5IHdoaWNoIGhpc3RvcmljIHBocmFzZSB1c2VkIHdoYXQgbW9kZWwuXG4gICAgICAgICAgICByZXR1cm4gJCgnPGRpdj4nKS50ZXh0KHZvaWNlSWQpLmh0bWwoKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBmbGFnID0gcGhyYXNlU3R1ZGlvSW5kZXguZmxhZ0NsYXNzRm9yKHZvaWNlLmxhbmd1YWdlKTtcbiAgICAgICAgY29uc3QgZmxhZ0h0bWwgPSBmbGFnID8gYDxpIGNsYXNzPVwiJHtmbGFnfSBmbGFnXCIgdGl0bGU9XCIke2VzY0F0dHIodm9pY2UubGFuZ3VhZ2VfbGFiZWwpfVwiPjwvaT5gIDogJyc7XG4gICAgICAgIGNvbnN0IGxhYmVsID0gYCR7dm9pY2Uudm9pY2VfbmFtZX0gKCR7dm9pY2UucXVhbGl0eX0pYDtcbiAgICAgICAgcmV0dXJuIGAke2ZsYWdIdG1sfSR7JCgnPGRpdj4nKS50ZXh0KGxhYmVsKS5odG1sKCl9YDtcbiAgICB9LFxuXG4gICAgcmVuZGVySGlzdG9yeVJvdyhyb3cpIHtcbiAgICAgICAgY29uc3QgY3JlYXRlZCAgID0gcm93LmNyZWF0ZWRfYXQgPyBuZXcgRGF0ZShyb3cuY3JlYXRlZF9hdCAqIDEwMDApLnRvTG9jYWxlU3RyaW5nKCkgOiAn4oCUJztcbiAgICAgICAgY29uc3QgZnVsbFRleHQgID0gcm93LnRleHQgfHwgJyc7XG4gICAgICAgIGNvbnN0IHNob3J0VGV4dCA9IGZ1bGxUZXh0Lmxlbmd0aCA+IDgwID8gYCR7ZnVsbFRleHQuc3Vic3RyaW5nKDAsIDgwKX3igKZgIDogZnVsbFRleHQ7XG4gICAgICAgIGNvbnN0IHZvaWNlSWQgICA9IHJvdy52b2ljZV9pZCB8fCAnJztcbiAgICAgICAgY29uc3QgcGxheVVybCAgID0gYCR7cGhyYXNlU3R1ZGlvSW5kZXguYXBpLnBocmFzZXN9LyR7cm93LmlkfTpkb3dubG9hZGA7XG4gICAgICAgIGNvbnN0IGRsVXJsICAgICA9IHBsYXlVcmw7XG4gICAgICAgIGNvbnN0IGZpbGVuYW1lICA9IGBwaHJhc2VfJHtyb3cuaWR9LndhdmA7XG4gICAgICAgIGNvbnN0IHRvb2x0aXAgICA9IGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19Sb3dSZXVzZVRvb2x0aXAgfHwgJyc7XG4gICAgICAgIGNvbnN0IGVzY0F0dHIgICA9IChzKSA9PiAkKCc8ZGl2PicpLnRleHQocykuaHRtbCgpLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKTtcbiAgICAgICAgcmV0dXJuIGA8dHIgY2xhc3M9XCJmaWxlLXJvd1wiIGlkPVwicGhyYXNlLXJvdy0ke3Jvdy5pZH1cIlxuICAgICAgICAgICAgICAgICAgICBkYXRhLXZhbHVlPVwiJHtwbGF5VXJsfVwiXG4gICAgICAgICAgICAgICAgICAgIGRhdGEtdGV4dD1cIiR7ZXNjQXR0cihmdWxsVGV4dCl9XCJcbiAgICAgICAgICAgICAgICAgICAgZGF0YS12b2ljZT1cIiR7ZXNjQXR0cih2b2ljZUlkKX1cIj5cbiAgICAgICAgICAgIDx0ZD4keyQoJzxkaXY+JykudGV4dChjcmVhdGVkKS5odG1sKCl9PC90ZD5cbiAgICAgICAgICAgIDx0ZCBjbGFzcz1cInBocmFzZS1yZXVzZVwiIHN0eWxlPVwiY3Vyc29yOnBvaW50ZXJcIiB0aXRsZT1cIiR7ZXNjQXR0cih0b29sdGlwKX1cIj5cbiAgICAgICAgICAgICAgICA8aSBjbGFzcz1cImZpbGUgYXVkaW8gb3V0bGluZSBpY29uXCI+PC9pPiR7JCgnPGRpdj4nKS50ZXh0KHNob3J0VGV4dCkuaHRtbCgpfVxuICAgICAgICAgICAgPC90ZD5cbiAgICAgICAgICAgIDx0ZD4ke3BocmFzZVN0dWRpb0luZGV4LmZvcm1hdFZvaWNlTGFiZWwodm9pY2VJZCl9PC90ZD5cbiAgICAgICAgICAgIDx0ZCBjbGFzcz1cInNpeCB3aWRlIGNkci1wbGF5ZXIgaGlkZS1vbi1tb2JpbGVcIj5cbiAgICAgICAgICAgICAgICA8dGFibGU+XG4gICAgICAgICAgICAgICAgICAgIDx0cj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDx0ZCBjbGFzcz1cIm9uZSB3aWRlXCI+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGJ1dHRvbiBjbGFzcz1cInVpIHRpbnkgYmFzaWMgaWNvbiBidXR0b24gcGxheS1idXR0b25cIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPGkgY2xhc3M9XCJ1aSBpY29uIHBsYXlcIj48L2k+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGF1ZGlvIHByZWxvYWQ9XCJub25lXCIgaWQ9XCJhdWRpby1wbGF5ZXItcGhyYXNlLXJvdy0ke3Jvdy5pZH1cIiBkYXRhLXNyYz1cIiR7cGxheVVybH1cIj5cbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgPHNvdXJjZSBzcmM9XCJcIi8+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9hdWRpbz5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dGQ+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cInVpIHJhbmdlIGNkci1wbGF5ZXJcIj48L2Rpdj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3M9XCJvbmUgd2lkZVwiPjxzcGFuIGNsYXNzPVwiY2RyLWR1cmF0aW9uXCI+PC9zcGFuPjwvdGQ+XG4gICAgICAgICAgICAgICAgICAgICAgICA8dGQgY2xhc3M9XCJvbmUgd2lkZVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIDxidXR0b24gY2xhc3M9XCJ1aSB0aW55IGJhc2ljIGljb24gYnV0dG9uIGRvd25sb2FkLWJ1dHRvblwiIGRhdGEtdmFsdWU9XCIke2RsVXJsfT9maWxlbmFtZT0ke2ZpbGVuYW1lfVwiPlxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA8aSBjbGFzcz1cInVpIGljb24gZG93bmxvYWRcIj48L2k+XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgPC9idXR0b24+XG4gICAgICAgICAgICAgICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgICAgICAgICA8L3RyPlxuICAgICAgICAgICAgICAgIDwvdGFibGU+XG4gICAgICAgICAgICA8L3RkPlxuICAgICAgICAgICAgPHRkIGNsYXNzPVwiY29sbGFwc2luZ1wiPlxuICAgICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ1aSB0aW55IGJhc2ljIGljb24gYnV0dG9ucyBhY3Rpb24tYnV0dG9uc1wiPlxuICAgICAgICAgICAgICAgICAgICA8YSBocmVmPVwiI1wiIGRhdGEtdmFsdWU9XCIke3Jvdy5pZH1cIlxuICAgICAgICAgICAgICAgICAgICAgICBjbGFzcz1cInVpIGJ1dHRvbiBkZWxldGUgdHdvLXN0ZXBzLWRlbGV0ZSBwb3B1cGVkXCJcbiAgICAgICAgICAgICAgICAgICAgICAgZGF0YS1jb250ZW50PVwiJHtlc2NBdHRyKGdsb2JhbFRyYW5zbGF0ZS5tb2R1bGVfcGhyYXNlX3N0dWRpb19IaXN0b3J5RGVsZXRlKX1cIj5cbiAgICAgICAgICAgICAgICAgICAgICAgIDxpIGNsYXNzPVwiaWNvbiB0cmFzaCByZWRcIj48L2k+XG4gICAgICAgICAgICAgICAgICAgIDwvYT5cbiAgICAgICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgIDwvdGQ+XG4gICAgICAgIDwvdHI+YDtcbiAgICB9LFxufTtcblxuJChkb2N1bWVudCkucmVhZHkoKCkgPT4ge1xuICAgIHBocmFzZVN0dWRpb0luZGV4LmluaXRpYWxpemUoKTtcbn0pO1xuIl19