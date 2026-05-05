# ModulePhraseStudio — guide for Claude

Offline TTS studio for MikoPBX. The module wraps the Piper engine and exposes
a REST + admin-cabinet UI for generating, caching and downloading WAV phrases.

## Layout

```
App/
  Controllers/ModulePhraseStudioController.php   index + saveAction (defaults)
  Views/ModulePhraseStudio/
    index.volt                                   tab shell (no wrapper segment)
    IndexTabs/{tabStudio,tabVoices,tabEngine,tabHistory}.volt
Lib/
  Engines/{EngineInterface,PiperEngine,PiperVoicesCatalog}.php
  PhraseStudioConf.php                           ConfigClass — onAfterModuleEnable + schema migration
  PhraseStudioMain.php                           business logic (engine bootstrap, generate, install, prune)
  Cli/install-voice.php                          one-shot detached runner for voice downloads
  RestAPI/{Engine,Voices,Phrases}/
    Controller.php                               #[ApiResource] / #[HttpMapping]
    Processor.php                                action dispatch
    DataStructure.php                            ApiParameter definitions
    Actions/*Action.php                          one per action
Models/{ModulePhraseStudio,PhraseStudioVoices,PhraseStudioPhrases}.php
Messages/{en,ru}.php                             translations (key 'BreadcrumbModulePhraseStudio')
Setup/PbxExtensionSetup.php                      empty — DB & routes auto-discovered
public/assets/{css,img,js/src,js}                source JS in src/, compiled in /
```

Runtime data lives outside git: `db/piper/`, `db/voices/`, `db/phrases/`,
`db/module.db` (excluded by `.gitignore`).

## REST API v3

All endpoints under `/pbxcore/api/v3/module-phrase-studio/`. Auth: localhost
or Bearer token.

| Method | Path                              | Action name (Processor case) |
|--------|-----------------------------------|------------------------------|
| GET    | `/engine`                         | `getList`                    |
| POST   | `/engine:install`                 | `install`                    |
| DELETE | `/engine`                         | `delete`                     |
| GET    | `/voices`                         | `getList`                    |
| POST   | `/voices:install`                 | `install`                    |
| DELETE | `/voices/{id}`                    | `delete`                     |
| GET    | `/phrases`                        | `getList`                    |
| POST   | `/phrases`                        | `create`                     |
| GET    | `/phrases/{id}:download`          | `download`                   |
| DELETE | `/phrases/{id}`                   | `delete`                     |

Important: MikoPBX core's `BaseRestController::mapHttpMethodToAction()` always
resolves `GET`-without-id → `getList` and `GET`-with-id → `getRecord`,
regardless of the names listed in `#[HttpMapping]`. Custom actions reachable
only via the `:action` URL suffix. **Do not rename Processor cases away from
the `getList / getRecord / create / update / patch / delete` set without
exposing them through `:custom`.**

## Sync vs. detached job split

The module follows the example pattern (Modules/EXAMPLES/REST-API/
ModuleExampleRestAPIv3): **no persistent module worker**. REST handlers
run inline inside the system `WorkerApiCommands`; long-running ops are
handed to a one-shot detached php process.

| Operation | Latency | Where it runs |
|-----------|---------|---------------|
| Cache-hit phrase lookup | < 50 ms | Inline (DB only) |
| Synthesize on cache miss | 1–3 s | Inline (Piper child + sox) |
| Promote (ffmpeg ×7) | 1–2 s | Inline (`SoundFilesConf::convertAudioFile`) |
| Voice install (curl 30–60 MB ×2 files) | 30 s – 2 min | `Lib/Cli/install-voice.php` via `Processes::mwExecBg` |

Synthesize and promote both fit comfortably inside `WorkerApiCommands`'
30-second sync timeout, so no offload is needed. Voice install does NOT
fit — `installVoice()` writes a placeholder row with
`install_status='installing'` and detaches a one-shot PHP runner via
nohup. The runner calls `executeVoiceInstall($voiceId)` and exits;
status updates land on the row, the UI polls `GET /voices`.

We deliberately do not register a Beanstalk worker (no
`getModuleWorkers()`) because:
  - voice install is a rare, one-time op — keeping a daemon idle is wasteful;
  - synthesize/promote already fit the request budget with no offload;
  - the example module shows the canonical "no module worker" pattern.

### convertAudioFile collision trap

`SoundFilesConf::convertAudioFile()` MUST be called with the cached WAV
in `db/phrases/` as its `$sourceFile`, not with a pre-copied file under
`output_dir/$baseName.wav`. For the `wav` target, ffmpeg would otherwise
read and write the same path and exit 234 ("input/output is same file"),
surfacing as "Audio conversion failed" via `convertAudioFile()`'s plain
exit-code reporting. `executePromotion()` enforces this — keep that
constraint when extending the action.

## Synthesis quirks

`PiperEngine::synthesize()` writes the input text into `outputPath.txt` and
runs `piper < file.txt` instead of `printf %s "$text" | piper`. Reason: when
`Processes::mwExec` runs the pipe form, UTF-8 input is dropped somewhere in
the wrapper layer and Piper produces ~200 ms of silence. The tmp-file path
keeps stdin clean.

Generation is gated by `max_text_length` (default 800 chars ≈ 60 s of audio);
cache pruned to `cache_size_limit` (default 500) on every successful generate.

## UI

Single index page with four tabs (Studio / Voices / Engine / History).
The "remember as default" checkbox in Studio POSTs `default_voice` and
`default_sample_rate` to `module-phrase-studio/save`; values are read back
on page load via `window.phraseStudioDefaults` injected by the controller.

`module.json` `min_pbx_version` must match the deployment target — currently
`2026.1.223`. Bump when relying on newer core APIs.

## Translations

The breadcrumb / page title key is `BreadcrumbModulePhraseStudio` (no
underscore — older `Breadcrumb_*` style does not work). Translation cache
is APCu-backed; toggling the module in admin-cabinet flushes it.

## Workflows after editing PHP

`WorkerApiCommands` is a long-living PHP worker process. After changing any
class loaded by the worker (Processor, Action, Engine, Model), the running
worker still holds the old bytecode in memory. **Disable + enable the module
in the admin cabinet** to recycle workers and clear the APCu cache. Editing
only AdminCabinet controllers / volts / JS does not require a worker restart
(opcache `validate_timestamps=1`).

## JS build

Source: `public/assets/js/src/module-phrase-studio-index.js`
Compiled: `public/assets/js/module-phrase-studio-index.js`

```bash
../../MikoPBXUtils/node_modules/.bin/babel \
  public/assets/js/src/module-phrase-studio-index.js \
  --out-dir public/assets/js \
  --source-maps inline \
  --presets airbnb
```

Mikopbx serves `cache/{Module}/{file}.js` via a symlink to the module's
`public/assets/js/` directory; missing compiled file → 404.

## SoundFiles "modify" hook (Phase 2)

The module injects a "Generate from text (Phrase Studio)" segment into
the core SoundFiles modify form **without** modifying the core repo:

1. `PhraseStudioConf::onVoltBlockCompile()` returns
   `Modules/ModulePhraseStudio/SoundFiles/modify` for `SoundFiles:Fields`
   so core's `hookVoltBlock('Fields')` renders our partial
   (`App/Views/SoundFiles/modify.volt`).
2. `PhraseStudioConf::onAfterAssetsPrepared()` ships
   `module-phrase-studio-soundfiles.js` only on `SoundFiles:modify`.
3. The JS detaches the partial-rendered segment and reinserts it under the
   "upload / record" segment so it appears where it logically belongs.
4. On generate the JS calls `POST /phrases` →
   `POST /phrases/{id}:promoteToTmp` → `SoundFilesAPI.convertAudioFile`
   (`temp_filename`, `category`).

`PromoteToTmpAction` copies the cached WAV into `WWW_UPLOAD_DIR`
(`/mountpoint/mikopbx/tmp/www_cache/upload_cache`) under a sanitised
basename. We must copy (not symlink/move) because the core
`convertAudioFile` uses `mv` and would otherwise drop the file from
the phrase cache.

JS source: `public/assets/js/src/module-phrase-studio-soundfiles.js` —
build it the same way as the index file.
