import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import admin from 'firebase-admin';

const {
  BOT_TOKEN, ADMIN_CHAT_ID, FIREBASE_SERVICE_ACCOUNT, BOT_USERNAME, ADMIN_PASSWORD, TOKEN_SECRET,
  FRONTEND_URL = '*', PORT = 3000,
  FIREBASE_DB_URL = 'https://gardenfoodsam-default-rtdb.firebaseio.com',
  CARD_NUMBER = '', CARD_OWNER = '', RECEIPT_TG = '',
} = process.env;
if (!BOT_TOKEN || !ADMIN_CHAT_ID || !FIREBASE_SERVICE_ACCOUNT || !BOT_USERNAME || !ADMIN_PASSWORD || !TOKEN_SECRET) {
  console.error('BOT_TOKEN, ADMIN_CHAT_ID, BOT_USERNAME, FIREBASE_SERVICE_ACCOUNT, ADMIN_PASSWORD, TOKEN_SECRET kerak!');
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(FIREBASE_SERVICE_ACCOUNT)), databaseURL: FIREBASE_DB_URL });
const db = admin.database();

// Frontend "tasdiqlang", "Yetkazib berildi", "Bekor qilindi" so'zlarini tekshiradi — o'zgartirmang
const STATUS = {
  unconfirmed: "⏳ Telegram'da tasdiqlang",
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
const EXPIRE_MS = 30 * 60 * 1000;

const SEED = JSON.parse(fs.readFileSync('./menu.json', 'utf8')); // { categories, items } — boshlang'ich menyu
let LIVE = {};                                                    // Firebase'dagi joriy menyu (admin o'zgartirsa darhol yangilanadi)
db.ref('menu/items').on('value', (s) => { LIVE = s.val() || {}; });
const findItem = (i) => {
  if (Object.keys(LIVE).length) {
    const it = LIVE[i.id] || Object.values(LIVE).find((v) => v.name === i.name);
    return it && it.available !== false ? it : null;
  }
  return SEED.items.find((m) => m.id === i.id || m.name === i.name) || null; // menyu hali bazaga ko'chirilmagan
};
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;
const tg = (method, body) =>
  fetch(`${TG}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const send = (chat_id, text, extra = {}) => tg('sendMessage', { chat_id, text, parse_mode: 'HTML', ...extra });
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const fmt = (n) => n.toLocaleString('en-US').replace(/,/g, ' ');

const orderText = (o) =>
  `🧾 <b>Buyurtma #${o.id}</b>\n👤 ${esc(o.name)}${o.username ? ` (@${esc(o.username)})` : ''}\n📞 +${esc(o.phone || '—')}\n📍 ${esc(o.address)}\n` +
  (o.location ? `🗺 <a href="https://maps.google.com/?q=${o.location.lat},${o.location.lng}">Xaritada ochish</a>\n` : '') +
  (o.zoneFree === true ? '🚚 Yetkazib berish: BEPUL (hudud ichida)\n' : o.zoneFree === false ? '🚚 Yetkazib berish: PULLIK (hudud tashqarida)\n' : '') +
  `💳 To'lov: ${o.payment === 'card' ? 'Karta (chek kutilmoqda)' : 'Naqd (kuryerga)'}\n\n` +
  o.items.map((i, n) => `${n + 1}. ${esc(i.name)} × ${i.qty} = ${fmt(i.price * i.qty)}`).join('\n') +
  `\n\n💰 <b>Jami: ${fmt(o.total)} so'm</b>\n📌 Holat: ${STATUS[o.status]}`;
const keyboard = (o) => {
  const row = (NEXT[o.status] || []).map((s) => ({ text: STATUS[s], callback_data: `${o.id}:${s}` }));
  return { inline_keyboard: row.length ? [row] : [] };
};
const payNote = (o) =>
  o.payment === 'card'
    ? `💳 Karta orqali to'lov${CARD_NUMBER ? `:\n<code>${esc(CARD_NUMBER)}</code>${CARD_OWNER ? ` (${esc(CARD_OWNER)})` : ''}` : ''}\nTo'lovdan so'ng chekni ${RECEIPT_TG ? esc(RECEIPT_TG) : 'bizga'} ga Telegram orqali yuboring.`
    : "💵 Naqd: kuryer yetib kelganda to'laysiz.";

// ---------- API ----------
const app = express();
app.set('trust proxy', 1);
app.use(cors({ origin: FRONTEND_URL === '*' ? true : FRONTEND_URL }));
app.use(express.json({ limit: '50kb' }));
app.get('/', (_, res) => res.send('Garden Food API ishlayapti'));

const rate = new Map();
app.post('/api/order', async (req, res) => {
  try {
    const hits = (rate.get(req.ip) || []).filter((t) => Date.now() - t < 3600000);
    if (hits.length >= 10) return res.json({ status: 'error', message: "Juda ko'p urinish, keyinroq qayta urinib ko'ring" });
    const { name, address, items, payment, location, zoneFree } = req.body || {};
    if (!name?.trim() || !address?.trim() || !Array.isArray(items)) return res.json({ status: 'error', message: "Ma'lumotlar to'liq emas" });

    const lines = items
      .map((i) => {
        const it = findItem(i);
        return it && { name: it.name, qty: Math.min(Math.max(parseInt(i.qty) || 0, 0), 50), price: Number(it.price) };
      })
      .filter((i) => i && i.price > 0 && i.qty);
    if (!lines.length) return res.json({ status: 'error', message: "Savatcha bo'sh" });

    const id = 'GF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const o = {
      id, name: name.trim().slice(0, 80), address: address.trim().slice(0, 200), items: lines,
      total: lines.reduce((s, i) => s + i.price * i.qty, 0), status: 'unconfirmed', createdAt: Date.now(),
      payment: payment === 'card' ? 'card' : 'cash',
      location: location && Number.isFinite(+location.lat) && Number.isFinite(+location.lng) ? { lat: +location.lat, lng: +location.lng } : null,
      zoneFree: typeof zoneFree === 'boolean' ? zoneFree : null,
    };
    await db.ref('ordersPrivate/' + id).set(o);               // to'liq ma'lumot — mijozlarga yopiq
    await db.ref(`orders/${id}/status`).set(STATUS.unconfirmed); // faqat holat — saytga ochiq
    rate.set(req.ip, [...hits, Date.now()]);
    res.json({ status: 'ok', orderId: id, botLink: `https://t.me/${BOT_USERNAME}?start=${id}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

// ---------- Admin API (menyu boshqaruvi) ----------
const hmac = (s) => crypto.createHmac('sha256', TOKEN_SECRET).update(s).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const adminAuth = (req, res, next) => {
  const [exp, sig] = (req.headers.authorization || '').replace('Bearer ', '').split('.');
  if (!exp || !sig || Number(exp) < Date.now() || !same(sig, hmac('admin.' + exp))) return res.status(401).json({ status: 'error', message: "Ruxsat yo'q" });
  next();
};
const wrap = (fn) => (req, res) => fn(req, res).catch((e) => { console.error(e); res.status(500).json({ status: 'error', message: 'Server xatosi' }); });
const BAD = { status: 'error', message: "Ma'lumotlar noto'g'ri" };
const okId = (id) => /^[A-Za-z0-9_-]{1,60}$/.test(id);

const loginTries = new Map();
app.post('/api/admin/login', (req, res) => {
  const t = (loginTries.get(req.ip) || []).filter((x) => Date.now() - x < 900000);
  if (t.length >= 5) return res.status(429).json({ status: 'error', message: "Juda ko'p urinish, 15 daqiqadan keyin urinib ko'ring" });
  if (!same(hmac('pw.' + String(req.body?.password || '')), hmac('pw.' + ADMIN_PASSWORD))) {
    loginTries.set(req.ip, [...t, Date.now()]);
    return res.json({ status: 'error', message: "Parol noto'g'ri" });
  }
  const exp = Date.now() + 12 * 3600e3;
  res.json({ status: 'ok', token: `${exp}.${hmac('admin.' + exp)}` });
});

const cleanItem = (b = {}) => {
  const price = Math.round(Number(b.price));
  if (!String(b.name || '').trim() || !(price >= 0) || price > 10000000 || !String(b.category || '').trim()) return null;
  return {
    name: String(b.name).trim().slice(0, 60), price, category: String(b.category).trim().slice(0, 40),
    img: String(b.img || '').trim().slice(0, 300), available: b.available !== false,
    sort: Number.isFinite(+b.sort) && b.sort !== undefined ? +b.sort : Date.now(),
  };
};
async function ensureCat(cat) {
  const ref = db.ref('menu/categories');
  const cur = (await ref.get()).val() || [];
  if (!cur.includes(cat)) await ref.set([...cur, cat]);
}

app.get('/api/admin/menu', adminAuth, wrap(async (_, res) => res.json({ status: 'ok', menu: (await db.ref('menu').get()).val() || {} })));

app.post('/api/admin/item', adminAuth, wrap(async (req, res) => {
  const it = cleanItem(req.body);
  if (!it) return res.json(BAD);
  const id = crypto.randomBytes(4).toString('hex');
  await db.ref('menu/items/' + id).set(it);
  await ensureCat(it.category);
  res.json({ status: 'ok', id });
}));

app.put('/api/admin/item/:id', adminAuth, wrap(async (req, res) => {
  const it = cleanItem(req.body);
  if (!it || !okId(req.params.id)) return res.json(BAD);
  const ref = db.ref('menu/items/' + req.params.id);
  const cur = (await ref.get()).val();
  if (!cur) return res.json({ status: 'error', message: 'Taom topilmadi' });
  if (req.body.sort === undefined) it.sort = cur.sort ?? it.sort; // tartib o'zgarmasligi uchun
  await ref.set(it);
  await ensureCat(it.category);
  res.json({ status: 'ok' });
}));

app.delete('/api/admin/item/:id', adminAuth, wrap(async (req, res) => {
  if (!okId(req.params.id)) return res.json(BAD);
  await db.ref('menu/items/' + req.params.id).remove();
  res.json({ status: 'ok' });
}));

app.put('/api/admin/categories', adminAuth, wrap(async (req, res) => {
  const c = [...new Set((req.body?.categories || []).map((x) => String(x).trim().slice(0, 40)).filter(Boolean))].slice(0, 30);
  if (!c.length) return res.json(BAD);
  await db.ref('menu/categories').set(c);
  res.json({ status: 'ok' });
}));

app.post('/api/admin/seed', adminAuth, wrap(async (req, res) => {
  const cur = (await db.ref('menu/items').get()).val();
  if (cur && Object.keys(cur).length && !req.body?.force) return res.json({ status: 'error', message: 'Menyu allaqachon yuklangan' });
  await db.ref('menu').set({ categories: SEED.categories, items: Object.fromEntries(SEED.items.map(({ id, ...v }) => [id, v])) });
  res.json({ status: 'ok' });
}));

app.listen(PORT, () => console.log('Server port', PORT));

// ---------- Telegram bot (long polling) ----------
async function confirmOrder(o, chat, phone, from) {
  const upd = { status: 'pending', phone, chatId: chat, username: from.username || null, confirmedAt: Date.now() };
  Object.assign(o, upd);
  await db.ref('ordersPrivate/' + o.id).update(upd);
  await db.ref(`orders/${o.id}/status`).set(STATUS.pending); // sayt shu yerdan real vaqtda yangilanadi
  await db.ref('users/' + chat).set({ phone });
  await db.ref('pending/' + chat).remove();
  await send(chat, `✅ <b>Buyurtma #${o.id} tasdiqlandi!</b>\n\n${payNote(o)}\n\nHolat saytda va shu yerda yangilanib turadi.`, { reply_markup: { remove_keyboard: true } });
  await send(ADMIN_CHAT_ID, orderText(o), { reply_markup: keyboard(o) });
}

async function onStart(m, id) {
  const chat = m.chat.id;
  const o = (await db.ref('ordersPrivate/' + id).get()).val();
  if (!o) return send(chat, '❌ Buyurtma topilmadi. Saytdan qaytadan buyurtma bering.');
  if (o.status !== 'unconfirmed') return send(chat, `ℹ️ Buyurtma #${id} allaqachon tasdiqlangan.`);
  if (Date.now() - o.createdAt > EXPIRE_MS) return send(chat, '⌛ Buyurtma muddati tugagan. Saytdan qaytadan buyurtma bering.');
  const known = (await db.ref('users/' + chat).get()).val();
  if (known?.phone) return confirmOrder(o, chat, known.phone, m.from); // avval raqam ulagan mijoz — darhol tasdiqlanadi
  await db.ref('pending/' + chat).set(id);
  return send(chat, `Buyurtma #${id} ni tasdiqlash uchun telefon raqamingizni ulashing 👇`, {
    reply_markup: { keyboard: [[{ text: '📱 Raqamni ulashish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
  });
}

async function onMessage(m) {
  if (m.chat.type !== 'private') return;
  const chat = m.chat.id;
  if (m.text?.startsWith('/start')) {
    const id = m.text.split(' ')[1];
    if (id) return onStart(m, id.trim());
    return send(chat, `Salom! Garden Food buyurtmasini tasdiqlash uchun saytdan buyurtma bering${FRONTEND_URL !== '*' ? `: ${FRONTEND_URL}` : ''}`);
  }
  if (m.contact) {
    if (m.contact.user_id !== m.from.id) return send(chat, "Iltimos, faqat o'zingizning raqamingizni ulashing.");
    const phone = String(m.contact.phone_number).replace(/\D/g, '');
    const id = (await db.ref('pending/' + chat).get()).val();
    const o = id ? (await db.ref('ordersPrivate/' + id).get()).val() : null;
    if (!o || o.status !== 'unconfirmed') {
      await db.ref('users/' + chat).set({ phone });
      return send(chat, 'Raqamingiz saqlandi. Buyurtmani saytdan bering.', { reply_markup: { remove_keyboard: true } });
    }
    return confirmOrder(o, chat, phone, m.from);
  }
}

async function onCallback(cb) {
  const [id, status] = (cb.data || '').split(':');
  const ref = db.ref('ordersPrivate/' + id);
  const o = (await ref.get()).val();
  const ok = o && String(cb.message?.chat?.id) === String(ADMIN_CHAT_ID) && (NEXT[o.status] || []).includes(status);
  if (!ok) return tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Amal mumkin emas' });
  o.status = status;
  await ref.update({ status });
  await db.ref(`orders/${id}/status`).set(STATUS[status]);
  await tg('answerCallbackQuery', { callback_query_id: cb.id, text: STATUS[status] });
  await tg('editMessageText', {
    chat_id: cb.message.chat.id, message_id: cb.message.message_id,
    text: orderText(o), parse_mode: 'HTML', reply_markup: keyboard(o),
  });
  if (o.chatId) send(o.chatId, `🧾 Buyurtma #${id}: ${STATUS[status]}`).catch(() => {});
}

await tg('deleteWebhook', { drop_pending_updates: false });
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
