# ModulePhraseStudio

On-server text-to-speech (TTS) phrase generator for MikoPBX, powered by [Piper TTS](https://github.com/rhasspy/piper).

## Features

- Generate `.wav` audio files from text on the MikoPBX server
- 25+ supported languages via downloadable Piper voice models
- Web UI in the admin cabinet: type the phrase, pick a voice, click Generate, listen, download
- Empty install — Piper binary and voice models are downloaded on demand from the UI
- Generated phrases are cached by `md5(text + voice + sample_rate)` to avoid re-synthesis
- Optional resampling to 8 kHz mono for direct telephony playback

## Architecture

```
Module package           — small (~100 KB), no binaries
Engine binary            — downloaded to db/piper/ on demand
Voice models (.onnx)     — downloaded to db/voices/ on demand (~30–60 MB each)
Generated phrases        — cached in db/phrases/
```

## REST API (v3, auto-discovered)

Base path: `/pbxcore/api/v3/module-phrase-studio`

| Method | Endpoint                       | Description                          |
|--------|--------------------------------|--------------------------------------|
| GET    | `engine`                       | Engine status (installed, version)   |
| POST   | `engine:install`               | Download and install Piper binary    |
| DELETE | `engine`                       | Remove Piper binary                  |
| GET    | `voices`                       | Catalog + installed voices           |
| POST   | `voices:install`               | Download voice model by ID           |
| DELETE | `voices/{id}`                  | Delete installed voice               |
| GET    | `phrases`                      | List previously generated phrases    |
| POST   | `phrases`                      | Generate a phrase from text          |
| GET    | `phrases/{id}:download`        | Download generated `.wav`            |
| DELETE | `phrases/{id}`                 | Delete a phrase from history         |

## Roadmap

- **Phase 1 (this release)**: standalone studio page + REST API + download
- **Phase 2**: integrate "Generate via TTS" button into the existing Sound Files modify page
  (next to the microphone-record and file-upload options)

## License

GPL-3.0-or-later
