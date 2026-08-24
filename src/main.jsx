import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function App() {
  const [status, setStatus] = useState('IDLE');
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [listening, setListening] = useState(false);
  const [training, setTraining] = useState(false);
  const recognition = useRef(null);
  const silenceTimer = useRef(null);
  const audioContext = useRef(null);
  const analyser = useRef(null);
  const micStream = useRef(null);
  const [level, setLevel] = useState(0);

  useEffect(() => () => stopListening(), []);

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
    const clean = text.trim();
    if (!clean) return;
    setStatus('THINKING');
    setReply('');
    try {
      const r = await fetch('/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: clean, training })
      });
      if (!r.ok) throw new Error(await r.text());
      const data = await r.json();
      setReply(data.reply || 'I did not receive a response.');
      speak(data.reply || 'I did not receive a response.');
    } catch (e) {
      const fallback = `Backend unavailable. Your command was: ${clean}`;
      setReply(fallback); setStatus('ERROR');
      speak(fallback);
    }
  };

  const startListening = async () => {
    window.speechSynthesis.cancel();
    if (!SpeechRecognition) { alert('Speech recognition is not supported in this browser. Use Chrome or Edge.'); return; }
    if (listening) { stopListening(); return; }
    const r = new SpeechRecognition();
    r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    r.onstart = () => { setListening(true); setStatus('LISTENING'); };
    r.onresult = (event) => {
      let finalText = '';
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        event.results[i].isFinal ? finalText += t : interim += t;
      }
      if (interim) setTranscript(interim);
      if (finalText) {
        const full = finalText.trim(); setTranscript(full);
        clearTimeout(silenceTimer.current);
        silenceTimer.current = setTimeout(() => { stopListening(); send(full); }, 350);
      }
    };
    r.onerror = () => { setListening(false); setStatus('ERROR'); };
    r.onend = () => setListening(false);
    recognition.current = r;
    r.start();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStream.current = stream;
      audioContext.current = new AudioContext();
      analyser.current = audioContext.current.createAnalyser();
      analyser.current.fftSize = 256;
      audioContext.current.createMediaStreamSource(stream).connect(analyser.current);
      const data = new Uint8Array(analyser.current.frequencyBinCount);
      const tick = () => {
        if (!analyser.current) return;
        analyser.current.getByteTimeDomainData(data);
        let sum = 0; for (const x of data) { const v = (x - 128) / 128; sum += v * v; }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        requestAnimationFrame(tick);
      }; tick();
    } catch {}
  };

  const stopListening = () => {
    clearTimeout(silenceTimer.current);
    recognition.current?.stop(); recognition.current = null;
    micStream.current?.getTracks().forEach(t => t.stop()); micStream.current = null;
    audioContext.current?.close(); audioContext.current = null; analyser.current = null;
    setListening(false);
    if (status === 'LISTENING') setStatus('IDLE');
  };

  const stopSpeaking = () => { window.speechSynthesis.cancel(); setStatus('IDLE'); };

  return <main className="app">
    <header><div className="brand"><span className="dot"/> PROMETHEUS</div><div className="system">VOICE AI OS <span className="online">● ONLINE</span></div></header>
    <aside>
      <div className="section">AGENTS</div>
      {['Prometheus','Researcher','Coder','Operator','Trainer'].map((x,i)=><div className={`agent ${i===0?'active':''}`} key={x}><span className="agentDot"/>{x}<small>{i===0?'CORE':'STANDBY'}</small></div>)}
      <div className="section train">TRAINING</div>
      <button className={`training ${training?'on':''}`} onClick={()=>setTraining(!training)}>{training?'TRAINING ACTIVE':'ENTER TRAINING MODE'}</button>
      <div className="hint">Streaming voice pipeline<br/>350ms speech cutoff<br/>Instant TTS interruption</div>
    </aside>
    <section className="stage">
      <div className={`orb ${status.toLowerCase()}`} style={{'--level':level}} onClick={status==='SPEAKING'?stopSpeaking:startListening}>
        <div className="ring r1"/><div className="ring r2"/><div className="core"/><div className="pulse"/>
      </div>
      <div className="state">{status}</div>
      <div className="live">{transcript || 'Tap the orb and speak'}</div>
      {reply && <div className="reply">{reply}</div>}
      <div className="controls"><button onClick={startListening}>{listening?'STOP LISTENING':'TALK TO PROMETHEUS'}</button><button className="ghost" onClick={stopSpeaking}>STOP VOICE</button></div>
    </section>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);