# Prometheus Neural Voice Setup

Prometheus now tries neural TTS in this order:

1. **Kokoro** at `http://127.0.0.1:8880/v1/audio/speech`
2. **Piper** at `http://127.0.0.1:8000/v1/audio/speech`
3. Browser `SpeechSynthesis` as the final fallback

The frontend sends an OpenAI-compatible speech request with `model: "kokoro"`, the configured agent voice, MP3 output, and the configured speech rate. Kokoro-FastAPI documents an OpenAI-compatible endpoint at `http://localhost:8880/v1/audio/speech`, with `model: "kokoro"`, direct voice IDs, MP3/WAV/Opus/FLAC output, and streaming support. citeturn898248search0turn898248search3

## Install Kokoro locally

The current Kokoro-FastAPI project supports CPU and GPU startup and exposes the OpenAI-compatible API on port `8880`. On Windows it provides `start-cpu.ps1` and `start-gpu.ps1`. citeturn898248search3

```powershell
git clone https://github.com/remsky/Kokoro-FastAPI.git
cd Kokoro-FastAPI
.\start-cpu.ps1
```

For an NVIDIA GPU, use:

```powershell
.\start-gpu.ps1
```

After startup, the API should be available at `http://localhost:8880`. citeturn898248search3

## Prometheus voice mapping

The current defaults are:

```text
PROMETHEUS  -> am_michael
NEXUS       -> am_fenrir
RESEARCHER  -> af_sarah
CEO         -> am_adam
CARROT      -> af_heart
SUSAN       -> af_sarah
OFFLINE     -> am_michael
```

The frontend reads these from Vite environment variables, so they can be changed without modifying source code.

## Environment variables

```env
VITE_KOKORO_TTS_URL=http://127.0.0.1:8880/v1/audio/speech
VITE_PIPER_TTS_URL=http://127.0.0.1:8000/v1/audio/speech
VITE_PROMETHEUS_VOICE=am_michael
VITE_NEXUS_VOICE=am_fenrir
VITE_RESEARCHER_VOICE=af_sarah
VITE_CEO_VOICE=am_adam
VITE_CARROT_VOICE=af_heart
VITE_SUSAN_VOICE=af_sarah
VITE_OFFLINE_VOICE=am_michael
```

## How the fallback works

If Kokoro is unavailable, Prometheus tries the configured Piper endpoint. If that is unavailable too, it falls back to the browser's built-in speech synthesis so voice output still works.

The UI reports the active engine as `KOKORO`, `PIPER`, or `BROWSER`.

## Latency behavior

Kokoro-FastAPI also documents OpenAI-compatible streaming. The integration is structured around an audio endpoint so the project can move to sentence/chunk streaming without replacing the agent voice layer. citeturn898248search0
