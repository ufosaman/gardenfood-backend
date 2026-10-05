import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import admin from 'firebase-admin';

const {
  BOT_TOKEN, ADMIN_CHAT_ID, FIREBASE_SERVICE_ACCOUNT, TOKEN_SECRET,
  BOT_USERNAME = '', FRONTEND_URL = '*', DEMO_OTP = 'false', PORT = 3000,
  FIREBASE_DB_URL = 'https://gardenfoodsam-default-rtdb.firebaseio.com',
} = process.env;
if (!BOT_TOKEN || !ADMIN_CHAT_ID || !FIREBASE_SERVICE_ACCOUNT || !TOKEN_SECRET) {
  console.error('BOT_TOKEN, ADMIN_CHAT_ID, FIREBASE_SERVICE_ACCOUNT, TOKEN_SECRET kerak!');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)),
  databaseURL: FIREBASE_DB_URL,
});
const db = admin.database();

// Frontend "Yetkazib berildi" / "Bekor qilindi" so'zlarini tekshiradi — o'zgartirmang
const STATUS = {
  pending: '📝 Qabul qilindi',
  confirmed: '✅ Tasdiqlandi',
  preparing: '👨‍🍳 Tayyorlanmoqda',
  delivering: "🚚 Yo'lda",
  done: '🎉 Yetkazib berildi',
  cancelled: '❌ Bekor qilindi',
};
const NEXT = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['delivering'],
  delivering: ['done'],
};

const PRICES = Object.fromEntries(JSON.parse(fs.readFileSync('./menu.json', 'utf8')).map((m) => [m.name, m.price]));
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;
const tg = (method, body) =>
  fetch(`${TG}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n) => n.toLocaleString('en-US').replace(/,/g, ' ');
const norm = (p) => String(p || '').replace(/\D/g, '');

const sign = (phone) => {
  const p = `${phone}.${Date.now() + 30 * 864e5}`;
  return `${p}.${crypto.createHmac('sha256', TOKEN_SECRET).update(p).digest('hex')}`;
};
const tokenOk = (token, phone) => {
  const [ph, exp, sig] = String(token || '').split('.');
  if (ph !== phone || Number(exp) < Date.now()) return false;
  const good = crypto.createHmac('sha256', TOKEN_SECRET).update(`${ph}.${exp}`).digest('hex');
  return sig?.length === good.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good));
};

const orderText = (o) =>
  `🧾 <b>Buyurtma #${o.id}</b>\n👤 ${esc(o.name)}\n📞 ${esc(o.phone)}\n📍 ${esc(o.address)}\n\n` +
  o.items.map((i, n) => `${n + 1}. ${esc(i.name)} × ${i.qty} = ${fmt(i.price * i.qty)}`).join('\n') +
  `\n\n💰 <b>Jami: ${fmt(o.total)} so'm</b>\n📌 Holat: ${STATUS[o.status]}`;
const keyboard = (o) => {
  const row = (NEXT[o.status] || []).map((s) => ({ text: STATUS[s], callback_data: `${o.id}:${s}` }));
  return { inline_keyboard: row.length ? [row] : [] };
};

// ---------- API ----------
const app = express();
app.use(cors({ origin: FRONTEND_URL === '*' ? true : FRONTEND_URL }));
app.use(express.json({ limit: '50kb' }));
app.get('/', (_, res) => res.send('Garden Food API ishlayapti'));

const otps = new Map();
app.post('/api/auth/send-otp', async (req, res) => {
  try {
    const phone = norm(req.body?.phone);
    if (phone.length < 9) return res.json({ status: 'error', message: "Telefon raqam noto'g'ri" });
    const prev = otps.get(phone);
    if (prev && Date.now() - prev.sent < 30000) return res.json({ status: 'error', message: "30 soniyadan keyin qayta urinib ko'ring" });
    const code = String(crypto.randomInt(100000, 1000000));
    otps.set(phone, { code, exp: Date.now() + 300000, tries: 0, sent: Date.now() });
    if (DEMO_OTP === 'true') return res.json({ status: 'ok', demo_code: code });
    const chat = (await db.ref('phones/' + phone).get()).val();
    if (!chat)
      return res.json({ status: 'error', message: `Avval t.me/${BOT_USERNAME} botiga kirib, /start bosing va raqamingizni ulashing` });
    await tg('sendMessage', { chat_id: chat, text: `Garden Food tasdiqlash kodi: ${code}` });
    res.json({ status: 'ok' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

app.post('/api/auth/verify-otp', (req, res) => {
  const phone = norm(req.body?.phone);
  const o = otps.get(phone);
  if (!o || o.exp < Date.now()) return res.json({ status: 'error', message: "Kod eskirgan, qayta so'rang" });
  if (++o.tries > 5) { otps.delete(phone); return res.json({ status: 'error', message: "Urinishlar ko'p, qayta so'rang" }); }
  if (String(req.body?.code).trim() !== o.code) return res.json({ status: 'error', message: "Kod noto'g'ri" });
  otps.delete(phone);
  res.json({ status: 'ok', token: sign(phone) });
});

const rate = new Map();
app.post('/api/order', async (req, res) => {
  try {
    const { name, address, items, token } = req.body || {};
    const phone = norm(req.body?.phone);
    if (!tokenOk(token, phone)) return res.json({ status: 'error', code: 'auth', message: 'Telefon tasdiqlanmagan' });
    const hits = (rate.get(phone) || []).filter((t) => Date.now() - t < 3600000);
    if (hits.length >= 5) return res.json({ status: 'error', message: "Juda ko'p buyurtma, keyinroq urinib ko'ring" });
    if (!name?.trim() || !address?.trim() || !Array.isArray(items)) return res.json({ status: 'error', message: "Ma'lumotlar to'liq emas" });

    const lines = items
      .map((i) => ({ name: String(i.name), qty: Math.min(Math.max(parseInt(i.qty) || 0, 0), 50), price: PRICES[i.name] }))
      .filter((i) => i.price && i.qty);
    if (!lines.length) return res.json({ status: 'error', message: "Savatcha bo'sh" });

    const id = 'GF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const o = {
      id, phone, name: name.trim().slice(0, 80), address: address.trim().slice(0, 200), items: lines,
      total: lines.reduce((s, i) => s + i.price * i.qty, 0), status: 'pending', createdAt: Date.now(),
    };
    await db.ref('ordersPrivate/' + id).set(o);          // to'liq ma'lumot — mijozlarga yopiq
    await db.ref(`orders/${id}/status`).set(STATUS.pending); // faqat holat — saytga ochiq
    rate.set(phone, [...hits, Date.now()]);
    await tg('sendMessage', { chat_id: ADMIN_CHAT_ID, text: orderText(o), parse_mode: 'HTML', reply_markup: keyboard(o) });
    res.json({ status: 'ok', orderId: id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

app.listen(PORT, () => console.log('Server port', PORT));

// ---------- Telegram (long polling) ----------
async function onCallback(cb) {
  const [id, status] = (cb.data || '').split(':');
  const ref = db.ref('ordersPrivate/' + id);
  const o = (await ref.get()).val();
  const ok = o && String(cb.message?.chat?.id) === String(ADMIN_CHAT_ID) && (NEXT[o.status] || []).includes(status);
  if (!ok) return tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Amal mumkin emas' });
  o.status = status;
  await ref.update({ status });
  await db.ref(`orders/${id}/status`).set(STATUS[status]); // sayt shu yerdan real vaqtda yangilanadi
  await tg('answerCallbackQuery', { callback_query_id: cb.id, text: STATUS[status] });
  await tg('editMessageText', {
    chat_id: cb.message.chat.id, message_id: cb.message.message_id,
    text: orderText(o), parse_mode: 'HTML', reply_markup: keyboard(o),
  });
}

// Mijoz botga /start bosib raqamini ulashadi — OTP kodlari shu orqali boradi
async function onMessage(m) {
  if (m.chat.type !== 'private') return;
  if (m.contact && m.contact.user_id === m.from.id) {
    await db.ref('phones/' + norm(m.contact.phone_number)).set(m.chat.id);
    return tg('sendMessage', { chat_id: m.chat.id, text: '✅ Raqamingiz ulandi. Saytga qaytib kodni oling.', reply_markup: { remove_keyboard: true } });
  }
  if (m.text?.startsWith('/start'))
    tg('sendMessage', {
      chat_id: m.chat.id, text: 'Garden Food: tasdiqlash kodini olish uchun raqamingizni ulashing.',
      reply_markup: { keyboard: [[{ text: '📱 Raqamni ulashish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    });
}

let offset = 0;
(async function poll() {
  try {
    const r = await tg('getUpdates', { offset, timeout: 30, allowed_updates: ['callback_query', 'message'] });
    for (const u of r.result || []) {
      offset = u.update_id + 1;
      if (u.callback_query) await onCallback(u.callback_query).catch(console.error);
      if (u.message) await onMessage(u.message).catch(console.error);
    }
  } catch (e) {
    console.error('poll xatosi:', e.message);
    await new Promise((r) => setTimeout(r, 3000));
  }
  poll();
})();
