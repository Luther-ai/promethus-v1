import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function App() {
  const [status, setStatus] = useState('IDLE');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [provider, setProvider] = useState('AUTO');
  const [serverStatus, setServerStatus] = useState({ local: false, online: false, mode: 'auto' });
  const [listening, setListening] = useState(false);
  const [training, setTraining] = useState(false);
  const recognition = useRef(null);
  const silenceTimer = useRef(null);
  const audioContext = useRef(null);
  const analyser = useRef(null);
  const micStream = useRef(null);
  const raf = useRef(null);
  const streamAbort = useRef(null);
  const speechQueue = useRef([]);
  const speechActive = useRef(false);
  const speechBuffer = useRef('');
  const streamDone = useRef(false);
  const [level, setLevel] = useState(0);

  const refreshStatus = async () => {
    try { const r = await fetch('/api/status'); if (r.ok) setServerStatus(await r.json()); } catch {}
  };
  useEffect(() => { refreshStatus(); const t = setInterval(refreshStatus, 5000); return () => { clearInterval(t); stopListening(); stopSpeaking(); }; }, []);

  const speakNext = () => {
    if (speechActive.current) return;
    const next = speechQueue.current.shift();
    if (!next) {
      if (streamDone.current) { speechActive.current = false; setStatus('IDLE'); }
      return;
    }
    speechActive.current = true;
    const u = new SpeechSynthesisUtterance(next);
    u.rate = 1.12;
    u.pitch = 0.98;
    u.volume = 1;
    u.onstart = () => setStatus('SPEAKING');
    u.onend = () => { speechActive.current = false; speakNext(); };
    u.onerror = () => { speechActive.current = false; speakNext(); };
    window.speechSynthesis.speak(u);
  };

  const queueSpeech = (incoming, flush = false) => {
    speechBuffer.current += incoming;
    // Start talking on punctuation or a reasonably sized phrase instead of waiting
    // for the whole answer. This is the major perceived-latency improvement.
    while (true) {
      const match = speechBuffer.current.match(/^(.{18,140}?[.!?](?:\s|$)|.{55,110}(?:\s|$))/s);
      if (!match) break;
      const phrase = match[1].trim();
      speechBuffer.current = speechBuffer.current.slice(match[1].length).trimStart();
      if (phrase) speechQueue.current.push(phrase);
    }
    if (flush && speechBuffer.current.trim()) {
      speechQueue.current.push(speechBuffer.current.trim());
      speechBuffer.current = '';
    }
    speakNext();
  };

  const send = async (text) => {
    const clean = text.trim(); if (!clean) return;
    setStatus('THINKING'); setReply(''); setProvider('AUTO');
    window.speechSynthesis.cancel();
    speechQueue.current = []; speechBuffer.current = ''; speechActive.current = false; streamDone.current = false;
    streamAbort.current?.abort();
    const controller = new AbortController(); streamAbort.current = controller;
    try {
      const r = await fetch('/api/chat/stream', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'text/event-stream' }, body: JSON.stringify({ message: clean, training }), signal: controller.signal });
      if (!r.ok || !r.body) throw new Error(await r.text() || 'AI stream failed');
      const reader = r.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let full = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n'); buffer = events.pop() || '';
        for (const event of events) {
          const line = event.split('\n').find(x => x.startsWith('data:'));
          if (!line) continue;
          const data = JSON.parse(line.slice(5).trim());
          if (data.type === 'provider') setProvider(data.provider);
          if (data.type === 'delta') {
            full += data.text;
            setReply(full);
            queueSpeech(data.text);
          }
          if (data.type === 'done') {
            streamDone.current = true;
            queueSpeech('', true);
          }
          if (data.type === 'error') throw new Error(data.error);
        }
      }
      streamDone.current = true;
      queueSpeech('', true);
      refreshStatus();
    } catch (e) {
      if (e.name === 'AbortError') return;
      const fallback = `Prometheus is unavailable: ${e.message}`; setReply(fallback); setStatus('ERROR');
    }
  };

  const startListening = async () => {
    window.speechSynthesis.cancel(); streamAbort.current?.abort();
    speechQueue.current = []; speechBuffer.current = ''; speechActive.current = false;
    if (!SpeechRecognition) { alert('Speech recognition is not supported in this browser. Use Chrome or Edge.'); return; }
    if (listening) { stopListening(); return; }
    const r = new SpeechRecognition(); r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    r.onstart = () => { setListening(true); setStatus('LISTENING'); };
    r.onresult = (event) => {
      let finalText = '', interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) { const t = event.results[i][0].transcript; event.results[i].isFinal ? finalText += t : interim += t; }
      if (interim) setTranscript(interim);
      if (finalText) { const full = finalText.trim(); setTranscript(full); clearTimeout(silenceTimer.current); silenceTimer.current = setTimeout(() => { stopListening(); send(full); }, 300); }
    };
    r.onerror = () => { setListening(false); setStatus('ERROR'); };
    r.onend = () => setListening(false);
    recognition.current = r; r.start();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); micStream.current = stream;
      audioContext.current = new (window.AudioContext || window.webkitAudioContext)(); analyser.current = audioContext.current.createAnalyser(); analyser.current.fftSize = 256; analyser.current.smoothingTimeConstant = .82;
      audioContext.current.createMediaStreamSource(stream).connect(analyser.current);
      const data = new Uint8Array(analyser.current.frequencyBinCount);
      const tick = () => {
        if (!analyser.current) return;
        analyser.current.getByteTimeDomainData(data); let sum = 0; for (const x of data) { const v = (x - 128) / 128; sum += v * v; }
        setLevel(prev => prev * .72 + Math.min(1, Math.sqrt(sum / data.length) * 4) * .28); raf.current = requestAnimationFrame(tick);
      }; tick();
    } catch {}
  };

  const stopListening = () => {
    clearTimeout(silenceTimer.current); recognition.current?.stop(); recognition.current = null;
    micStream.current?.getTracks().forEach(t => t.stop()); micStream.current = null;
    if (raf.current) cancelAnimationFrame(raf.current); raf.current = null;
    audioContext.current?.close(); audioContext.current = null; analyser.current = null;
    setLevel(0); setListening(false); if (status === 'LISTENING') setStatus('IDLE');
  };
  const stopSpeaking = () => {
    streamAbort.current?.abort(); streamAbort.current = null; window.speechSynthesis.cancel(); speechQueue.current = []; speechBuffer.current = ''; speechActive.current = false; streamDone.current = false; setStatus('IDLE');
  };

  const modeLabel = serverStatus.mode === 'offline' ? 'OFFLINE' : serverStatus.mode === 'online' ? 'ONLINE' : 'AUTO';
  return <main className="app">
    <header><div className="brand"><span className="dot"/> PROMETHEUS</div><div className="system">VOICE AI OS <span className={serverStatus.local ? 'online' : 'warning'}>● {serverStatus.local ? 'LOCAL READY' : 'LOCAL OFF'}</span><span className="modeBadge">{modeLabel}</span></div></header>
    <aside>
      <div className="section">AGENTS</div>
      {['Prometheus','Researcher','Coder','Operator','Trainer'].map((x,i)=><div className={`agent ${i===0?'active':''}`} key={x}><span className="agentDot"/>{x}<small>{i===0?'CORE':'STANDBY'}</small></div>)}
      <div className="section train">AI MODE</div>
      <div className="modeGrid">
        {['auto','offline','online'].map(m => <button key={m} className={modeLabel.toLowerCase()===m?'selected':''} onClick={async()=>{ await fetch('/api/mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:m})}); refreshStatus(); }}>{m.toUpperCase()}</button>)}
      </div>
      <div className="section train">TRAINING</div>
      <button className={`training ${training?'on':''}`} onClick={()=>setTraining(!training)}>{training?'TRAINING ACTIVE':'ENTER TRAINING MODE'}</button>
      <div className="hint">LOCAL: {serverStatus.local ? 'READY' : 'START OLLAMA'}<br/>ONLINE: {serverStatus.online ? 'CONFIGURED' : 'NO API KEY'}<br/>LAST: {provider}</div>
    </aside>
    <section className="stage">
      <div className={`orb ${status.toLowerCase()}`} style={{'--level':level}} onClick={status==='SPEAKING'?stopSpeaking:startListening}>
        <div className="ambient"/><div className="ring r1"/><div className="ring r2"/><div className="ring r3"/><div className="core"/><div className="pulse p1"/><div className="pulse p2"/>
      </div>
      <div className="state">{status}</div><div className="live">{transcript || 'Tap the orb and speak'}</div>{reply && <div className="reply">{reply}</div>}
      <div className="controls"><button onClick={startListening}>{listening?'STOP LISTENING':'TALK TO PROMETHEUS'}</button><button className="ghost" onClick={stopSpeaking}>STOP VOICE</button></div>
    </section>
  </main>;
}
createRoot(document.getElementById('root')).render(<App />);