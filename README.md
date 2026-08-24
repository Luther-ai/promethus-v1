# Prometheus AI OS

Prometheus is a voice-first AI operating system built around a central orchestrator and specialist agents.

## Architecture

- **Prometheus** — Jarvis-style orchestrator and advisor.
- **Nexus** — full-stack engineer. Protected operations create approval requests.
- **Researcher** — live evidence workflow with Tavily or Brave Search.
- **CEO** — startup/business strategist.
- **Carrot** — librarian/trainer that creates persistent knowledge artifacts and mastery curricula.
- **Susan** — secretary/daily operations agent.
- **Offline** — reserved for a native PC companion/local automation layer.

The UI intentionally hides chat history until the archive drawer is opened.

## Runtime

The frontend is a Vite app. The runtime is a small Node HTTP service with no backend framework dependency.

```bash
npm install
cp .env.example .env
npm run server
npm run dev
```

The runtime defaults to `http://localhost:8787`.

## Model routing

Use provider-qualified model selectors such as:

- `openrouter:openai/gpt-5.6`
- `openai:gpt-5.6`
- `anthropic:claude-sonnet-4-5`
- `gemini:gemini-3.7-flash`
- `xai:grok-4`
- `custom:<model>`

This keeps agents independent from any single model vendor. Add any other OpenAI-compatible provider through `CUSTOM_AI_BASE_URL`, `CUSTOM_AI_API_KEY`, and `CUSTOM_AI_MODEL`.

## Truth / evidence policy

Prometheus does not have permission to invent real-world facts. The Researcher only claims live verification when a search provider is configured and returns evidence. Missing evidence is reported as missing evidence.

## Persistence

Runtime data is stored locally under:

- `data/prometheus.json`
- `knowledge/<agent>/...`

The generated knowledge files are designed to be readable and syncable with tools such as Obsidian later.

## Security

Nexus can plan code changes without executing protected operations. Requests containing deployment, destructive database, credential, publishing, or similar actions become approval requests. The approval surface is visible in the UI.
