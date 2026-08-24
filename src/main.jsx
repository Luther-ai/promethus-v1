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
  const [level, setLevel] = useState(0);

  const refreshStatus = async () => {
    try { const r = await fetch('/api/status'); if (r.ok) setServerStatus(await r.json()); } catch {}
  };
  useEffect(() => { refreshStatus(); const t = setInterval(refreshStatus, 5000); return () => { clearInterval(t); stopListening(); }; }, []);

  const speak = (text) => {
    if (!text) return;
    window.speechSynthesis.cancel();
    const chunks = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
    let i = 0;
    const next = () => {
      if (i >= chunks.length) { setStatus('IDLE'); return; }
      const u = new SpeechSynthesisUtterance(chunks[i++].trim());
      u.rate = 1.08; u.pitch = 0.98;
      u.onstart = () => setStatus('SPEAKING');
      u.onend = next;
      window.speechSynthesis.speak(u);
    };
    next();
  };

  const send = async (text) => {
    const clean = text.trim(); if (!clean) return;
    setStatus('THINKING'); setReply('');
    try {
      const r = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: clean, training }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'AI request failed');
      setProvider(data.provider || 'AUTO'); setReply(data.reply || 'No response generated.'); speak(data.reply || 'No response generated.');
      refreshStatus();
    } catch (e) {
      const fallback = `Prometheus is unavailable: ${e.message}`; setReply(fallback); setStatus('ERROR');
    }
  };

  const startListening = async () => {
    window.speechSynthesis.cancel();
    if (!SpeechRecognition) { alert('Speech recognition is not supported in this browser. Use Chrome or Edge.'); return; }
    if (listening) { stopListening(); return; }
    const r = new SpeechRecognition(); r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    r.onstart = () => { setListening(true); setStatus('LISTENING'); };
    r.onresult = (event) => {
      let finalText = '', interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) { const t = event.results[i][0].transcript; event.results[i].isFinal ? finalText += t : interim += t; }
      if (interim) setTranscript(interim);
      if (finalText) { const full = finalText.trim(); setTranscript(full); clearTimeout(silenceTimer.current); silenceTimer.current = setTimeout(() => { stopListening(); send(full); }, 350); }
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
  const stopSpeaking = () => { window.speechSynthesis.cancel(); setStatus('IDLE'); };

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