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
  PhraseStudioConf.php                           ConfigClass — onAfterModuleEnable
  PhraseStudioMain.php                           business logic (engine bootstrap, generate, prune)
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
cd /Volumes/DevDisk/Developement/mikopbx/MikoPBXUtils
node node_modules/.bin/babel \
  /path/to/public/assets/js/src/module-phrase-studio-index.js \
  --out-file /path/to/public/assets/js/module-phrase-studio-index.js \
  --source-maps inline
```

Mikopbx serves `cache/{Module}/{file}.js` via a symlink to the module's
`public/assets/js/` directory; missing compiled file → 404.

## Phase 2 (open)

Inject a third icon into the "Add new sound" core partial that posts to
`/phrases`, promotes the resulting WAV into `tmp/uploads/`, and hands the
filename to the existing `SoundFilesAPI.convertAudioFile` flow. Either via:

1. a new core hook `onBeforeShowSoundFilePartial`, or
2. a JS injector run on `/sound-files/modify` pages, plus a new endpoint
   `POST /phrases/{id}:promote-to-tmp` returning the staged filename.

Option (2) keeps the change in the module — this is the planned approach.
