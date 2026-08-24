import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({limit:'1mb'}));

app.post('/api/chat', async (req,res) => {
  const { message, training } = req.body || {};
  if (!message) return res.status(400).send('message required');
  const key = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini';
  if (!key) return res.json({reply:'Prometheus is connected, but OPENROUTER_API_KEY is not configured yet.'});
  try {
    const system = `You are Prometheus, a fast voice-first AI operating system assistant. Be concise when speaking. ${training ? 'You are in TRAINING MODE: teach the requested subject deeply, organize knowledge into concepts, examples and practice, and remember the current training objective within this session.' : ''}`;
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method:'POST', headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','HTTP-Referer':'http://localhost:5173','X-Title':'Prometheus AI OS'},
      body:JSON.stringify({model,stream:false,messages:[{role:'system',content:system},{role:'user',content:message}],temperature:.35,max_tokens:500})
    });
    if(!r.ok) return res.status(r.status).send(await r.text());
    const data=await r.json();
    res.json({reply:data.choices?.[0]?.message?.content || 'No response generated.'});
  } catch(e){ res.status(500).send(e.message); }
});

app.use(express.static(path.join(__dirname,'..')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'..','index.html')));
const port=process.env.PORT||3000;
app.listen(port,()=>console.log(`Prometheus running on http://localhost:${port}`));