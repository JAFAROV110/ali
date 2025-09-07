// server.js — подробный логирующий прокси для sign-запросов
import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Подробные логи
morgan.token('body', (req) => {
  try { return JSON.stringify(req.body).slice(0, 500); } catch { return '-'; }
});
app.use(morgan(':method :url -> :status :res[content-length]B :response-time ms body=:body'));

const UPSTREAM_BASE = (process.env.UPSTREAM_BASE || 'https://tiktok.eulerstream.com').replace(/\/+$/, '');
const API_KEY = (process.env.EULER_API_KEY || '').trim();

if (!API_KEY) {
  console.error('EULER_API_KEY is missing in Render Environment Variables');
  process.exit(1);
}

app.get('/health', (req, res) => res.json({ ok: true, upstream: UPSTREAM_BASE }));

function upstreamUrl(path) {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${UPSTREAM_BASE}${p}`;
}

app.all('*', async (req, res) => {
  try {
    const url = upstreamUrl(req.originalUrl);
    const method = req.method;

    // Заголовки к апстриму
    const headers = {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
    };

    // Тело запроса
    const isJson = req.is('application/json');
    const body = ['GET','HEAD'].includes(method) ? undefined
      : (isJson ? JSON.stringify(req.body) : new URLSearchParams(req.body));

    // Локальный лог:
    console.log('[proxy] → upstream:', method, url);

    const resp = await fetch(url, { method, headers, body, redirect: 'follow' });
    const text = await resp.text();

    console.log('[proxy] ← upstream:', resp.status, `${text?.length || 0}B`, 'for', url);
    res.status(resp.status);
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) res.set('content-type', 'application/json');
    res.send(text);
  } catch (e) {
    console.error('Proxy error:', e?.message || e);
    res.status(502).json({ error: 'proxy_failed', message: e?.message || String(e) });
  }
});

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(`Sign proxy ready on :${PORT}, upstream ${UPSTREAM_BASE}`));
