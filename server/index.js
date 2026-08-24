import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));

const port = process.env.PORT || 3000;
const mode = process.env.AI_MODE || 'auto';
const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const openRouterModel = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';

const systemPrompt = `You are Prometheus, a fast voice-first AI operating system assistant. Be concise when speaking. Never claim you performed a computer action unless the local operator actually confirmed it. ${process.env.PROMETHEUS_PERSONALITY || ''}`;

async function ollamaChat(message, training = false) {
  const system = `${systemPrompt} ${training ? 'You are in TRAINING MODE: teach clearly with concepts, examples and practice.' : ''}`;
  const r = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: message }], options: { temperature: 0.35 } })
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.message?.content || 'No local response generated.';
}

async function openRouterChat(message, training = false) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not configured');
  const system = `${systemPrompt} ${training ? 'You are in TRAINING MODE: teach clearly with concepts, examples and practice.' : ''}`;
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Prometheus AI OS' },
    body: JSON.stringify({ model: openRouterModel, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: message }], temperature: 0.35, max_tokens: 500 })
  });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || 'No online response generated.';
}

async function getAI(message, training) {
  if (mode === 'offline') return { reply: await ollamaChat(message, training), provider: 'LOCAL', model: ollamaModel };
  if (mode === 'online') return { reply: await openRouterChat(message, training), provider: 'ONLINE', model: openRouterModel };
  try {
    return { reply: await ollamaChat(message, training), provider: 'LOCAL', model: ollamaModel };
  } catch (localError) {
    try {
      return { reply: await openRouterChat(message, training), provider: 'ONLINE', model: openRouterModel };
    } catch (onlineError) {
      throw new Error(`No AI provider available. Start Ollama for offline mode or configure OpenRouter for online mode. Local: ${localError.message}`);
    }
  }
}

app.get('/api/status', async (_req, res) => {
  let local = false;
  try { const r = await fetch(`${ollamaUrl}/api/tags`); local = r.ok; } catch {}
  res.json({ mode, local, online: Boolean(process.env.OPENROUTER_API_KEY), model: local ? ollamaModel : openRouterModel });
});

app.post('/api/chat', async (req, res) => {
  const { message, training = false } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });
  try {
    const result = await getAI(message.trim(), training);
    res.json(result);
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

app.use(express.static(path.join(__dirname, '..')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.listen(port, () => console.log(`Prometheus running on http://localhost:${port} (${mode} mode)`));