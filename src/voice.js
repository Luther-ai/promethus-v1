const KOKORO_URL = import.meta.env.VITE_KOKORO_TTS_URL || 'http://127.0.0.1:8880/v1/audio/speech';
const PIPER_URL = import.meta.env.VITE_PIPER_TTS_URL || 'http://127.0.0.1:8000/v1/audio/speech';

export const VOICE_PROFILES = {
  prometheus: { name: 'PROMETHEUS', voice: import.meta.env.VITE_PROMETHEUS_VOICE || 'am_michael', rate: 0.96, pitch: 0.88 },
  nexus: { name: 'NEXUS', voice: import.meta.env.VITE_NEXUS_VOICE || 'am_fenrir', rate: 1.02, pitch: 0.96 },
  researcher: { name: 'RESEARCHER', voice: import.meta.env.VITE_RESEARCHER_VOICE || 'af_sarah', rate: 0.98, pitch: 1.02 },
  ceo: { name: 'CEO', voice: import.meta.env.VITE_CEO_VOICE || 'am_adam', rate: 0.99, pitch: 0.94 },
  carrot: { name: 'CARROT', voice: import.meta.env.VITE_CARROT_VOICE || 'af_heart', rate: 0.96, pitch: 1.04 },
  susan: { name: 'SUSAN', voice: import.meta.env.VITE_SUSAN_VOICE || 'af_sarah', rate: 1.0, pitch: 1.05 },
  offline: { name: 'OFFLINE', voice: import.meta.env.VITE_OFFLINE_VOICE || 'am_michael', rate: 1.0, pitch: 0.96 },
};

let currentAudio = null;

function stopBrowserSpeech() {
  try { window.speechSynthesis?.cancel(); } catch {}
}

export function stopSpeaking() {
  stopBrowserSpeech();
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio.src = '';
    currentAudio = null;
  }
}

function browserSpeak(text, agentId) {
  if (!('speechSynthesis' in window)) throw new Error('Browser speech synthesis is unavailable.');
  const profile = VOICE_PROFILES[agentId] || VOICE_PROFILES.prometheus;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = profile.rate;
  utterance.pitch = profile.pitch;
  const voices = window.speechSynthesis.getVoices();
  const preferred = voices.find(v => /en(-|_)(US|GB)/i.test(v.lang)) || voices[0];
  if (preferred) utterance.voice = preferred;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return { engine: 'browser', voice: preferred?.name || 'system voice' };
}

async function neuralSpeak(url, text, profile) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'audio/mpeg' },
    body: JSON.stringify({
      model: 'kokoro',
      input: text,
      voice: profile.voice,
      response_format: 'mp3',
      speed: profile.rate,
    }),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const blob = await response.blob();
  const audioUrl = URL.createObjectURL(blob);
  stopSpeaking();
  const audio = new Audio(audioUrl);
  currentAudio = audio;
  audio.onended = () => {
    URL.revokeObjectURL(audioUrl);
    if (currentAudio === audio) currentAudio = null;
  };
  await audio.play();
  return { engine: url === KOKORO_URL ? 'kokoro' : 'piper', voice: profile.voice };
}

export async function speak(text, agentId = 'prometheus', onState = () => {}) {
  const clean = String(text || '').replace(/```[\s\S]*?```/g, '').trim();
  if (!clean) return { engine: 'none' };
  const profile = VOICE_PROFILES[agentId] || VOICE_PROFILES.prometheus;
  stopSpeaking();
  onState('speaking');

  const attempts = [
    ['kokoro', KOKORO_URL],
    ['piper', PIPER_URL],
  ];

  for (const [, url] of attempts) {
    try {
      const result = await neuralSpeak(url, clean.slice(0, 4000), profile);
      onState('spoken', result);
      return result;
    } catch {}
  }

  try {
    const result = browserSpeak(clean.slice(0, 1000), agentId);
    onState('spoken', result);
    return result;
  } catch (error) {
    onState('error', error);
    throw error;
  }
}

export function getTtsConfig() {
  return {
    kokoro: KOKORO_URL,
    piper: PIPER_URL,
    profiles: VOICE_PROFILES,
  };
}
