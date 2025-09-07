import 'dotenv/config';
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import morgan from 'morgan';

const app = express();
app.use(cors());
app.use(morgan('tiny'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const UPSTREAM_BASE = (process.env.UPSTREAM_BASE || 'https://tiktok.eulerstream.com').replace(/\/+$/, '');
const API_KEY = (process.env.EULER_API_KEY || '').trim();

if (!API_KEY) {
  console.error('EULER_API_KEY is missing in server .env');
  process.exit(1);
}

function upstreamUrl(path, qs = '') {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${UPSTREAM_BASE}${p}${qs ? (p.includes('?') ? '&' : '?') + qs : ''}`;
}

async function proxy(req, res, pathOverride) {
  try {
    const url = upstreamUrl(pathOverride ?? req.originalUrl);
    const method = req.method;
    const headers = {
      'Authorization': `Bearer ${API_KEY}`,
      'Accept': 'application/json',
      // прокидываем полезные заголовки, но очищаем host/length
      ...Object.fromEntries(Object.entries(req.headers).filter(([k]) => !['host','content-length'].includes(k.toLowerCase())))
    };

    const body = ['GET','HEAD'].includes(method) ? undefined : (req.is('application/json') ? JSON.stringify(req.body) : new URLSearchParams(req.body));

    const resp = await fetch(url, { method, headers, body, redirect: 'follow' });
    const text = await resp.text();

    res.status(resp.status);
    // простенько определим json
    if ((resp.headers.get('content-type') || '').includes('application/json')) {
      res.set('content-type', 'application/json');
    }
    res.send(text);
  } catch (e) {
    console.error('Proxy error:', e?.message || e);
    res.status(502).json({ error: 'proxy_failed', message: e?.message || String(e) });
  }
}

// Healthcheck
app.get('/health', (req, res) => res.json({ ok: true, upstream: UPSTREAM_BASE }));

// Проксим ВСЕ пути на апстрим (совместимо с тем, что ждёт tiktok-live-connector)
app.all('*', async (req, res) => proxy(req, res));

const PORT = Number(process.env.PORT || 8080);
app.listen(PORT, () => console.log(`Sign proxy ready on :${PORT}, upstream ${UPSTREAM_BASE}`));
