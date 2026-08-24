import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));

const port = process.env.PORT || 3000;
let currentMode = process.env.AI_MODE || 'auto';
const ollamaUrl = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const ollamaModel = process.env.OLLAMA_MODEL || 'qwen2.5:3b';
const openRouterModel = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
const systemPrompt = `You are Prometheus, a fast voice-first AI operating system assistant. Be concise when speaking. Never claim you performed a computer action unless the local operator actually confirmed it. ${process.env.PROMETHEUS_PERSONALITY || ''}`;

function promptFor(training) {
  return `${systemPrompt} ${training ? 'You are in TRAINING MODE: teach clearly with concepts, examples and practice.' : ''}`;
}

async function ollamaChat(message, training = false) {
  const r = await fetch(`${ollamaUrl}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: ollamaModel, stream: false, messages: [{ role: 'system', content: promptFor(training) }, { role: 'user', content: message }], options: { temperature: 0.35 } }) });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const data = await r.json(); return data.message?.content || 'No local response generated.';
}

async function openRouterChat(message, training = false) {
  const key = process.env.OPENROUTER_API_KEY; if (!key) throw new Error('OPENROUTER_API_KEY is not configured');
  const r = await fetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Prometheus AI OS' }, body: JSON.stringify({ model: openRouterModel, stream: false, messages: [{ role: 'system', content: promptFor(training) }, { role: 'user', content: message }], temperature: 0.35, max_tokens: 500 }) });
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${await r.text()}`);
  const data = await r.json(); return data.choices?.[0]?.message?.content || 'No online response generated.';
}

async function localAvailable() {
  try { const r = await fetch(`${ollamaUrl}/api/tags`); return r.ok; } catch { return false; }
}

async function chooseProvider() {
  if (currentMode === 'offline') return 'LOCAL';
  if (currentMode === 'online') return 'ONLINE';
  if (await localAvailable()) return 'LOCAL';
  if (process.env.OPENROUTER_API_KEY) return 'ONLINE';
  throw new Error('No AI provider available. Start Ollama or configure OpenRouter.');
}

async function getAI(message, training) {
  const provider = await chooseProvider();
  if (provider === 'LOCAL') return { reply: await ollamaChat(message, training), provider, model: ollamaModel };
  return { reply: await openRouterChat(message, training), provider, model: openRouterModel };
}

function sse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function streamOllama(message, training, res, req) {
  const upstream = await fetch(`${ollamaUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ollamaModel, stream: true, messages: [{ role: 'system', content: promptFor(training) }, { role: 'user', content: message }], options: { temperature: 0.35 } }),
    signal: req.signal
  });
  if (!upstream.ok || !upstream.body) throw new Error(`Ollama ${upstream.status}: ${await upstream.text()}`);
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const item = JSON.parse(line);
      const delta = item.message?.content || '';
      if (delta) sse(res, { type: 'delta', text: delta });
      if (item.done) sse(res, { type: 'done' });
    }
  }
}

async function streamOpenRouter(message, training, res, req) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY is not configured');
  const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'http://localhost:3000', 'X-Title': 'Prometheus AI OS' },
    body: JSON.stringify({ model: openRouterModel, stream: true, messages: [{ role: 'system', content: promptFor(training) }, { role: 'user', content: message }], temperature: 0.35, max_tokens: 500 }),
    signal: req.signal
  });
  if (!upstream.ok || !upstream.body) throw new Error(`OpenRouter ${upstream.status}: ${await upstream.text()}`);
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() || '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') { sse(res, { type: 'done' }); continue; }
      try {
        const item = JSON.parse(payload);
        const delta = item.choices?.[0]?.delta?.content || '';
        if (delta) sse(res, { type: 'delta', text: delta });
      } catch {}
    }
  }
}

app.get('/api/status', async (_req, res) => { const local = await localAvailable(); res.json({ mode: currentMode, local, online: Boolean(process.env.OPENROUTER_API_KEY), model: local ? ollamaModel : openRouterModel }); });
app.post('/api/mode', (req, res) => { const requested = String(req.body?.mode || '').toLowerCase(); if (!['auto','offline','online'].includes(requested)) return res.status(400).json({ error: 'mode must be auto, offline, or online' }); currentMode = requested; res.json({ mode: currentMode }); });

app.post('/api/chat/stream', async (req, res) => {
  const { message, training = false } = req.body || {};
  if (!message?.trim()) return res.status(400).json({ error: 'message required' });
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  try {
    const provider = await chooseProvider();
    sse(res, { type: 'provider', provider, model: provider === 'LOCAL' ? ollamaModel : openRouterModel });
    if (provider === 'LOCAL') await streamOllama(message.trim(), training, res, req);
    else await streamOpenRouter(message.trim(), training, res, req);
  } catch (e) {
    if (!res.writableEnded) sse(res, { type: 'error', error: e.message });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

app.post('/api/chat', async (req, res) => { const { message, training = false } = req.body || {}; if (!message?.trim()) return res.status(400).json({ error: 'message required' }); try { res.json(await getAI(message.trim(), training)); } catch (e) { res.status(503).json({ error: e.message }); } });
app.use(express.static(path.join(__dirname, '..')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, '..', 'index.html')));
app.listen(port, () => console.log(`Prometheus running on http://localhost:${port} (${currentMode} mode)`));