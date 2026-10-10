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

// ---------- Tillar (mijozga boradigan bot xabarlari) ----------
const LANGS = ['uz', 'ru', 'en', 'hi'];
const lg = (x) => (LANGS.includes(x) ? x : 'uz');
const fromTg = (code) => lg(String(code || '').slice(0, 2));
const SL = {
  uz: STATUS,
  ru: { unconfirmed: '⏳ Подтвердите в Telegram', pending: '📝 Заказ принят', confirmed: '✅ Подтверждён', preparing: '👨‍🍳 Готовится', delivering: '🚚 В пути', done: '🎉 Доставлен', cancelled: '❌ Отменён' },
  en: { unconfirmed: '⏳ Confirm in Telegram', pending: '📝 Order received', confirmed: '✅ Confirmed', preparing: '👨‍🍳 Preparing', delivering: '🚚 On the way', done: '🎉 Delivered', cancelled: '❌ Cancelled' },
  hi: { unconfirmed: '⏳ Telegram में पुष्टि करें', pending: '📝 ऑर्डर प्राप्त हुआ', confirmed: '✅ पुष्टि हो गई', preparing: '👨‍🍳 तैयार हो रहा है', delivering: '🚚 रास्ते में', done: '🎉 डिलीवर हो गया', cancelled: '❌ रद्द किया गया' },
};
const B = {
  uz: {
    share: '📱 Raqamni ulashish', askPhone: (id) => `Buyurtma #${id} ni tasdiqlash uchun telefon raqamingizni ulashing 👇`,
    hello: 'Salom! Buyurtmani tasdiqlash uchun avval saytdan buyurtma bering.',
    notFound: '❌ Buyurtma topilmadi. Saytdan qaytadan buyurtma bering.', already: (id) => `ℹ️ Buyurtma #${id} allaqachon tasdiqlangan.`,
    expired: '⌛ Buyurtma muddati tugagan. Saytdan qaytadan buyurtma bering.', ownNum: "Iltimos, faqat o'zingizning raqamingizni ulashing.",
    saved: 'Raqamingiz saqlandi. Buyurtmani saytdan bering.',
    confirmed: (id, pay) => `✅ <b>Buyurtma #${id} tasdiqlandi!</b>\n\n${pay}\n\nHolat saytda va shu yerda yangilanib turadi.`,
    cash: "💵 Naqd: kuryer yetib kelganda to'laysiz.",
    card: (n, o, r) => `💳 Karta orqali to'lov${n ? `:\n<code>${n}</code>${o ? ` (${o})` : ''}` : ''}\nTo'lovdan so'ng chekni ${r || 'bizga'} ga Telegram orqali yuboring.`,
    status: (id, s) => `🧾 Buyurtma #${id}: ${s}`, rate: 'Xizmatimiz yoqdimi? Baholang 👇',
    thanksRate: (n) => `Rahmat! Siz ${n}⭐ baho berdingiz.\nXohlasangiz, izohingizni shu yerga yozing 💬`,
    already2: 'Siz allaqachon baho bergansiz', thanks: 'Rahmat!', commentOk: '🙏 Izohingiz qabul qilindi, rahmat!',
  },
  ru: {
    share: '📱 Поделиться номером', askPhone: (id) => `Чтобы подтвердить заказ #${id}, поделитесь номером телефона 👇`,
    hello: 'Здравствуйте! Чтобы подтвердить заказ, сначала оформите его на сайте.',
    notFound: '❌ Заказ не найден. Оформите заказ на сайте заново.', already: (id) => `ℹ️ Заказ #${id} уже подтверждён.`,
    expired: '⌛ Срок подтверждения заказа истёк. Оформите заказ на сайте заново.', ownNum: 'Пожалуйста, поделитесь только своим номером.',
    saved: 'Ваш номер сохранён. Оформите заказ на сайте.',
    confirmed: (id, pay) => `✅ <b>Заказ #${id} подтверждён!</b>\n\n${pay}\n\nСтатус обновляется на сайте и здесь.`,
    cash: '💵 Наличными: оплата курьеру при получении.',
    card: (n, o, r) => `💳 Оплата картой${n ? `:\n<code>${n}</code>${o ? ` (${o})` : ''}` : ''}\nПосле перевода отправьте чек ${r || 'нам'} в Telegram.`,
    status: (id, s) => `🧾 Заказ #${id}: ${s}`, rate: 'Понравилось обслуживание? Оцените 👇',
    thanksRate: (n) => `Спасибо! Вы поставили ${n}⭐.\nЕсли хотите, напишите отзыв сюда 💬`,
    already2: 'Вы уже оценили заказ', thanks: 'Спасибо!', commentOk: '🙏 Ваш отзыв принят, спасибо!',
  },
  en: {
    share: '📱 Share my number', askPhone: (id) => `To confirm order #${id}, please share your phone number 👇`,
    hello: 'Hello! Please place your order on the website first to confirm it.',
    notFound: '❌ Order not found. Please place the order on the website again.', already: (id) => `ℹ️ Order #${id} is already confirmed.`,
    expired: '⌛ The confirmation window has expired. Please place the order again.', ownNum: 'Please share only your own number.',
    saved: 'Your number is saved. Place your order on the website.',
    confirmed: (id, pay) => `✅ <b>Order #${id} confirmed!</b>\n\n${pay}\n\nThe status is updated here and on the website.`,
    cash: '💵 Cash: pay the courier on delivery.',
    card: (n, o, r) => `💳 Card payment${n ? `:\n<code>${n}</code>${o ? ` (${o})` : ''}` : ''}\nAfter the transfer, please send the receipt to ${r || 'us'} on Telegram.`,
    status: (id, s) => `🧾 Order #${id}: ${s}`, rate: 'Did you like our service? Rate us 👇',
    thanksRate: (n) => `Thank you! You gave ${n}⭐.\nIf you like, write your comment here 💬`,
    already2: 'You have already rated this order', thanks: 'Thank you!', commentOk: '🙏 Your comment was received, thank you!',
  },
  hi: {
    share: '📱 नंबर साझा करें', askPhone: (id) => `ऑर्डर #${id} की पुष्टि के लिए अपना फ़ोन नंबर साझा करें 👇`,
    hello: 'नमस्ते! ऑर्डर की पुष्टि के लिए पहले वेबसाइट पर ऑर्डर करें।',
    notFound: '❌ ऑर्डर नहीं मिला। कृपया वेबसाइट पर दोबारा ऑर्डर करें।', already: (id) => `ℹ️ ऑर्डर #${id} की पहले ही पुष्टि हो चुकी है।`,
    expired: '⌛ पुष्टि का समय समाप्त हो गया। कृपया दोबारा ऑर्डर करें।', ownNum: 'कृपया केवल अपना ही नंबर साझा करें।',
    saved: 'आपका नंबर सहेज लिया गया है। वेबसाइट पर ऑर्डर करें।',
    confirmed: (id, pay) => `✅ <b>ऑर्डर #${id} की पुष्टि हो गई!</b>\n\n${pay}\n\nस्थिति यहाँ और वेबसाइट पर अपडेट होती रहेगी।`,
    cash: '💵 नकद: डिलीवरी पर कूरियर को भुगतान करें।',
    card: (n, o, r) => `💳 कार्ड से भुगतान${n ? `:\n<code>${n}</code>${o ? ` (${o})` : ''}` : ''}\nट्रांसफ़र के बाद रसीद Telegram पर ${r || 'हमें'} को भेजें।`,
    status: (id, s) => `🧾 ऑर्डर #${id}: ${s}`, rate: 'हमारी सेवा कैसी लगी? रेटिंग दें 👇',
    thanksRate: (n) => `धन्यवाद! आपने ${n}⭐ रेटिंग दी।\nचाहें तो अपनी टिप्पणी यहाँ लिखें 💬`,
    already2: 'आप पहले ही रेटिंग दे चुके हैं', thanks: 'धन्यवाद!', commentOk: '🙏 आपकी टिप्पणी मिल गई, धन्यवाद!',
  },
};
// Saytga: holat matni (admin guruhi uchun o'zbekcha) + kaliti (sayt o'z tiliga tarjima qiladi)
const setPublic = (id, key) => db.ref('orders/' + id).update({ status: STATUS[key], statusKey: key });

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
  (o.note ? `📝 Izoh: ${esc(o.note)}\n` : '') +
  `💳 To'lov: ${o.payment === 'card' ? 'Karta (chek kutilmoqda)' : 'Naqd (kuryerga)'}\n\n` +
  o.items.map((i, n) => `${n + 1}. ${esc(i.name)} × ${i.qty} = ${fmt(i.price * i.qty)}`).join('\n') +
  `\n\n💰 <b>Jami: ${fmt(o.total)} so'm</b>\n📌 Holat: ${STATUS[o.status]}`;
const keyboard = (o) => {
  const row = (NEXT[o.status] || []).map((s) => ({ text: STATUS[s], callback_data: `${o.id}:${s}` }));
  return { inline_keyboard: row.length ? [row] : [] };
};
const payNote = (o) => {
  const T = B[lg(o.lang)];
  return o.payment === 'card' ? T.card(esc(CARD_NUMBER), esc(CARD_OWNER), esc(RECEIPT_TG)) : T.cash;
};

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
    const { name, address, items, payment, location, zoneFree, note, lang } = req.body || {};
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
      note: String(note || '').trim().slice(0, 300),
      lang: lg(lang),
      location: location && Number.isFinite(+location.lat) && Number.isFinite(+location.lng) ? { lat: +location.lat, lng: +location.lng } : null,
      zoneFree: typeof zoneFree === 'boolean' ? zoneFree : null,
    };
    await db.ref('ordersPrivate/' + id).set(o);               // to'liq ma'lumot — mijozlarga yopiq
    await setPublic(id, 'unconfirmed'); // faqat holat — saytga ochiq
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

// ---------- Baho va izohlar ----------
async function addReview(id, rating, comment = '') {
  const ref = db.ref('ordersPrivate/' + id);
  const o = (await ref.get()).val();
  const n = Math.round(Number(rating));
  if (!o || o.status !== 'done' || !(n >= 1 && n <= 5) || o.review) return null; // faqat yetkazilgan va hali baholanmagan buyurtma
  const review = { rating: n, comment: String(comment || '').trim().slice(0, 500), createdAt: Date.now() };
  await ref.update({ review });
  await db.ref('reviews/' + id).set({ ...review, name: o.name });
  send(ADMIN_CHAT_ID, `⭐ <b>Yangi baho: ${n}/5</b> — #${id} (${esc(o.name)})${review.comment ? `\n💬 ${esc(review.comment)}` : ''}`).catch(() => {});
  return review;
}
async function addComment(id, text) {
  const o = (await db.ref('ordersPrivate/' + id).get()).val();
  const comment = String(text).trim().slice(0, 500);
  if (!o?.review || o.review.comment || !comment) return false;
  await db.ref(`ordersPrivate/${id}/review/comment`).set(comment);
  await db.ref(`reviews/${id}/comment`).set(comment);
  send(ADMIN_CHAT_ID, `💬 <b>Izoh</b> — #${id} (${esc(o.name)}) ${o.review.rating}⭐:\n${esc(comment)}`).catch(() => {});
  return lg(o.lang);
}
const reviewHits = new Map();
app.post('/api/review', wrap(async (req, res) => {
  const h = (reviewHits.get(req.ip) || []).filter((t) => Date.now() - t < 3600000);
  if (h.length >= 20) return res.json({ status: 'error', message: "Juda ko'p urinish" });
  reviewHits.set(req.ip, [...h, Date.now()]);
  const { orderId, rating, comment } = req.body || {};
  const rv = okId(String(orderId)) ? await addReview(String(orderId), rating, comment) : null;
  res.json(rv ? { status: 'ok' } : { status: 'error', message: 'Baho qabul qilinmadi (buyurtma yetkazilmagan yoki allaqachon baholangan)' });
}));
app.get('/api/admin/reviews', adminAuth, wrap(async (_, res) => {
  const all = Object.entries((await db.ref('reviews').get()).val() || {}).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.createdAt - a.createdAt);
  const avg = all.length ? Math.round((all.reduce((s, x) => s + x.rating, 0) / all.length) * 10) / 10 : 0;
  res.json({ status: 'ok', count: all.length, avg, list: all.slice(0, 50) });
}));

app.listen(PORT, () => console.log('Server port', PORT));

// ---------- Telegram bot (long polling) ----------
async function confirmOrder(o, chat, phone, from) {
  const upd = { status: 'pending', phone, chatId: chat, username: from.username || null, confirmedAt: Date.now() };
  Object.assign(o, upd);
  await db.ref('ordersPrivate/' + o.id).update(upd);
  await setPublic(o.id, 'pending'); // sayt shu yerdan real vaqtda yangilanadi
  await db.ref('users/' + chat).set({ phone });
  await db.ref('pending/' + chat).remove();
  await send(chat, B[lg(o.lang)].confirmed(o.id, payNote(o)), { reply_markup: { remove_keyboard: true } });
  await send(ADMIN_CHAT_ID, orderText(o), { reply_markup: keyboard(o) });
}

async function onStart(m, id) {
  const chat = m.chat.id;
  const o = (await db.ref('ordersPrivate/' + id).get()).val();
  if (!o) return send(chat, B[fromTg(m.from.language_code)].notFound);
  const T = B[lg(o.lang)];
  if (o.status !== 'unconfirmed') return send(chat, T.already(id));
  if (Date.now() - o.createdAt > EXPIRE_MS) return send(chat, T.expired);
  const known = (await db.ref('users/' + chat).get()).val();
  if (known?.phone) return confirmOrder(o, chat, known.phone, m.from); // avval raqam ulagan mijoz — darhol tasdiqlanadi
  await db.ref('pending/' + chat).set(id);
  return send(chat, T.askPhone(id), {
    reply_markup: { keyboard: [[{ text: T.share, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
  });
}

async function onMessage(m) {
  if (m.chat.type !== 'private') return;
  const chat = m.chat.id;
  if (m.text?.startsWith('/start')) {
    const id = m.text.split(' ')[1];
    if (id) return onStart(m, id.trim());
    return send(chat, B[fromTg(m.from.language_code)].hello + (FRONTEND_URL !== '*' ? `\n${FRONTEND_URL}` : ''));
  }
  if (m.contact) {
    if (m.contact.user_id !== m.from.id) return send(chat, B[fromTg(m.from.language_code)].ownNum);
    const phone = String(m.contact.phone_number).replace(/\D/g, '');
    const id = (await db.ref('pending/' + chat).get()).val();
    const o = id ? (await db.ref('ordersPrivate/' + id).get()).val() : null;
    if (!o || o.status !== 'unconfirmed') {
      await db.ref('users/' + chat).set({ phone });
      return send(chat, B[o ? lg(o.lang) : fromTg(m.from.language_code)].saved, { reply_markup: { remove_keyboard: true } });
    }
    return confirmOrder(o, chat, phone, m.from);
  }
  if (m.text && !m.text.startsWith('/')) { // baholashdan keyin yozilgan izoh
    const oid = (await db.ref('reviewPending/' + chat).get()).val();
    const cl = oid ? await addComment(oid, m.text) : false;
    if (cl) {
      await db.ref('reviewPending/' + chat).remove();
      return send(chat, B[cl].commentOk);
    }
  }
}

async function onCallback(cb) {
  if (cb.data?.startsWith('rate:')) { // mijoz botda yulduzcha bosdi
    const [, oid, n] = cb.data.split(':');
    const ord = (await db.ref('ordersPrivate/' + oid).get()).val();
    if (!ord || String(ord.chatId) !== String(cb.message?.chat?.id)) return tg('answerCallbackQuery', { callback_query_id: cb.id });
    const T = B[lg(ord.lang)];
    const rv = await addReview(oid, n);
    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: rv ? T.thanks : T.already2 });
    if (rv) {
      await db.ref('reviewPending/' + cb.message.chat.id).set(oid);
      await tg('editMessageText', { chat_id: cb.message.chat.id, message_id: cb.message.message_id, text: T.thanksRate(rv.rating) });
    }
    return;
  }
  const [id, status] = (cb.data || '').split(':');
  const ref = db.ref('ordersPrivate/' + id);
  const o = (await ref.get()).val();
  const ok = o && String(cb.message?.chat?.id) === String(ADMIN_CHAT_ID) && (NEXT[o.status] || []).includes(status);
  if (!ok) return tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Amal mumkin emas' });
  o.status = status;
  await ref.update({ status });
  await setPublic(id, status);
  await tg('answerCallbackQuery', { callback_query_id: cb.id, text: STATUS[status] });
  await tg('editMessageText', {
    chat_id: cb.message.chat.id, message_id: cb.message.message_id,
    text: orderText(o), parse_mode: 'HTML', reply_markup: keyboard(o),
  });
  if (o.chatId) send(o.chatId, B[lg(o.lang)].status(id, SL[lg(o.lang)][status])).catch(() => {});
  if (status === 'done' && o.chatId)
    send(o.chatId, B[lg(o.lang)].rate, { reply_markup: { inline_keyboard: [[1, 2, 3, 4, 5].map((n) => ({ text: `${n}⭐`, callback_data: `rate:${id}:${n}` }))] } }).catch(() => {});
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
