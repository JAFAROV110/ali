// index.js — TikTok чат -> TTS на Алису Лайт через Bluetooth
// Установка: npm i tiktok-live-connector say p-queue dotenv

require('dotenv').config();

const { TikTokLiveConnection, SignConfig } = require('tiktok-live-connector');
const say = require('say');
const PQueue = require('p-queue').default;

// === КЛЮЧ И СИГНЕР ===
const API_KEY = (process.env.EULER_API_KEY || '').trim();
const hasKey = !!API_KEY;

// Можно переопределить свой базовый URL сигнера через .env (SIGN_BASE_URL)
// ИНАЧЕ используем актуальный публичный URL от Euler:
const DEFAULT_SIGN_BASE = 'https://tiktok.eulerstream.com';
const SIGN_BASE_URL = (process.env.SIGN_BASE_URL || DEFAULT_SIGN_BASE).trim();

console.log('🔐 Signer key present:', hasKey ? 'YES' : 'NO');
console.log('🌐 Sign server base:', SIGN_BASE_URL);

// ВАЖНО: ключ и базовый путь нужно выставлять ДО создания клиента
if (hasKey) {
  SignConfig.apiKey = API_KEY;                   // оф. способ задать ключ
}
SignConfig.basePath = SIGN_BASE_URL;             // актуальный базовый URL сигнера
// Дополнительно можно накинуть заголовки при желании:
// SignConfig.baseOptions.headers['X-Custom-Header'] = 'value';

// ====== НАСТРОЙКИ ======
const USERNAME   = process.env.TIKTOK_USERNAME;          // ник без @
const VOICE      = process.env.VOICE_RU || undefined;    // напр. 'Microsoft Irina Desktop'
const RATE       = Number(process.env.RATE || 1.0);      // скорость TTS (0.7–1.3)
const READ_CHAT  = (process.env.READ_CHAT ?? 'true').toLowerCase() === 'true';
const READ_GIFTS = (process.env.READ_GIFTS ?? 'true').toLowerCase() === 'true';
const MIN_LEN    = Number(process.env.MIN_LEN || 1);     // мин. длина сообщения
const MAX_LEN    = Number(process.env.MAX_LEN || 180);   // макс. длина озвучки

if (!USERNAME) {
  console.error('❌ Укажите TIKTOK_USERNAME в .env (ник без @).');
  process.exit(1);
}

// ====== HELPERS ======
const queue = new PQueue({ concurrency: 1 });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function sanitize(text) {
  if (!text) return '';
  let t = String(text).replace(/\s+/g, ' ').trim();
  t = t.replace(/https?:\/\/\S+/gi, ' ссылка ');
  if (t.length > MAX_LEN) t = t.slice(0, MAX_LEN - 1) + '…';
  return t;
}
function looksLikeSpam(text) {
  const banned = [/http/i, /t\.me/i, /vk\.com/i, /discord\.gg/i, /join/i, /взаим/i];
  return banned.some(rx => rx.test(text));
}
function speak(text) {
  return new Promise(resolve => {
    say.speak(text, VOICE, RATE, err => {
      if (err) console.error('Ошибка TTS:', err);
      resolve();
    });
  });
}

// ====== КЛИЕНТ TIKTOK (передаём ключ и тут — для совместимости с разными версиями) ======
const tiktok = new TikTokLiveConnection(USERNAME, {
  requestOptions: { timeout: 10000 },
  signApiKey: hasKey ? API_KEY : undefined, // дублируем ключ в опциях клиента
  // Можно запретить fallback-и, если хочешь строго использовать свой basePath:
  // disableEulerFallbacks: true,
});

// ====== СОБЫТИЯ ======
tiktok.on('connected', (state) => {
  const nick = state?.roomInfo?.owner?.nickname || `@${USERNAME}`;
  console.log(`✅ Подключено к чату ${nick}`);
});

tiktok.on('disconnected', () => {
  console.log('⚠️ Отключено. Переподключаюсь через 3 сек…');
  setTimeout(() => safeConnect(6).catch(() => {}), 3000);
});

tiktok.on('chat', (msg) => {
  if (!READ_CHAT) return;
  const user = msg?.uniqueId || 'Гость';
  const text = sanitize(msg?.comment);
  if (!text || text.length < MIN_LEN) return;
  if (looksLikeSpam(text)) return;

  const phrase = `${user} пишет: ${text}`;
  queue.add(async () => {
    console.log('💬', phrase);
    await speak(phrase);
    await sleep(500);
  }).catch(console.error);
});

tiktok.on('gift', (ev) => {
  if (!READ_GIFTS) return;
  const user  = ev?.uniqueId || 'Зритель';
  const gift  = ev?.giftName || 'подарок';
  const count = ev?.repeatCount || 1;
  const phrase = `${user} отправил ${count} ${gift}`;
  queue.add(async () => {
    console.log('🎁', phrase);
    await speak(phrase);
    await sleep(400);
  }).catch(console.error);
});

// ====== НАДЁЖНЫЙ КОННЕКТ С РЕТРАЯМИ ======
async function safeConnect(maxAttempts = 8) {
  let attempt = 1, delay = 1200;
  while (attempt <= maxAttempts) {
    try {
      await tiktok.connect();
      return;
    } catch (e) {
      const reason = e?.reason || e?.message || String(e);
      const status = e?.status || e?.response?.status || '';
      console.error(`🔁 Попытка ${attempt} не удалась: ${reason}${status ? ` (status ${status})` : ''}`);
      if (attempt === maxAttempts) throw e;
      await sleep(delay);
      delay = Math.min(Math.floor(delay * 1.8), 15000);
      attempt++;
    }
  }
}

// ====== СТАРТ ======
safeConnect().catch(err => {
  console.error('❌ Не удалось подключиться:', err?.reason || err?.message || err);
  process.exit(1);
});

process.stdin.setEncoding('utf8');
console.log('🧪 Введите текст и нажмите Enter — озвучим его на Алисе Лайт.');
process.stdin.on('data', data => {
  const t = sanitize(data);
  if (!t || t.length < MIN_LEN) return;
  if (looksLikeSpam(t)) return;
  queue.add(async () => {
    console.log('🗣️ (локально)', t);
    await speak(t);
  }).catch(console.error);
});
