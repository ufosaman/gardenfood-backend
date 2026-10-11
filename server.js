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

const LANGS = ['uz', 'ru', 'en', 'hi'];
const lg = (x) => (LANGS.includes(x) ? x : 'uz');
const SL = {
  uz: STATUS,
  ru: { unconfirmed: '⏳ Подтвердите в Telegram', pending: '📝 Заказ принят', confirmed: '✅ Подтверждён', preparing: '👨‍🍳 Готовится', delivering: '🚚 В пути', done: '📁 Доставлен', cancelled: '❌ Отменён' },
  en: { unconfirmed: '⏳ Confirm in Telegram', pending: '📝 Order received', confirmed: '✅ Confirmed', preparing: '👨‍🍳 Preparing', delivering: '🚚 On the way', done: '🎉 Delivered', cancelled: '❌ Cancelled' },
  hi: { unconfirmed: '⏳ Telegram में पुष्टि करें', pending: '📝 ऑर्डर प्राप्त हुआ', confirmed: '✅ पुष्टि हो गई', preparing: '👨‍🍳 तैयार हो रहा है', delivering: '🚚 रास्ते में', done: '🎉 डिलीवर हो गया', cancelled: '❌ रद्द किया गया' },
};

const B = {
  uz: {
    chooseLang: '🇺🇿 Iltimos, tilni tanlang:\n🇷🇺 Пожалуйста, выберите язык:\n🇬🇳 Please choose a language:\n🇮🇳 कृपया भाषा चुनें:',
    share: '📱 Raqamni ulashish',
    askPhone: '📱 Telefon raqamingizni ulashing 👇',
    ownNum: "Iltimos, faqat o'zingizning raqamingizni ulashing.",
    askLocation: '📍 Yetkazib berish manzilini aniqlash uchun geolokatsiyangizni yuboring 👇',
    shareLoc: '📍 Geolokatsiyani yuborish',
    categoriesTitle: '📂 Kategoriyani tanlang:',
    emptyCart: '⚠️ Savatchangiz bo\'sh!',
    cartHeader: '🛒 <b>Sizning savatchangiz:</b>\n\n',
    askNote: '✍️ Buyurtma uchun umumiy izoh yozing (masalan: Uy raqami, orientir):',
    skipNote: '⏭ Izohsiz davom etish',
    paymentChoice: '\n💰 <b>Jami:</b> {total} so\'m\n\nTo\'lov turini tanlang:',
    payCash: '💵 Naqd pul',
    payCard: '💳 Karta orqali',
    orderDoneBot: (id, pay) => `🎉 <b>Buyurtmangiz muvaffaqiyatli qabul qilindi!</b>\n\n🧾 Buyurtma ID: #${id}\n${pay}\n\nTez orada xodimlarimiz siz bilan bog'lanishadi.`,
    cash: "💵 Naqd: kuryer yetib kelganda to'laysiz.",
    card: (n, o, r) => `💳 Karta orqali to'lov${n ? `:\n<code>${n}</code>${o ? ` (${o})` : ''}` : ''}\nTo'lovdan so'ng chekni ${r || 'bizga'} ga Telegram orqali yuboring.`,
    status: (id, s) => `🧾 Buyurtma #${id}: ${s}`, 
    rate: 'Xizmatimiz yoqdimi? Baholang 👇',
    thanksRate: (n) => `Rahmat! Siz ${n}⭐ baho berdingiz.\nXohlasangiz, izohingizni shu yerga yozing 💬`,
    already2: 'Siz allaqachon baho bergansiz', thanks: 'Rahmat!', commentOk: '🙏 Izohingiz qabul qilindi, rahmat!',
  },
  ru: {
    chooseLang: '🇷🇺 Пожалуйста, выберите язык:',
    share: '📱 Поделиться номером',
    askPhone: '📱 Поделитесь номером телефона 👇',
    ownNum: 'Пожалуйста, поделитесь только своим номером.',
    askLocation: '📍 Отправьте вашу геолокацию для определения адреса доставки 👇',
    shareLoc: '📍 Отправить геолокацию',
    categoriesTitle: '📂 Выберите категорию:',
    emptyCart: '⚠️ Ваша корзина пуста!',
    cartHeader: '🛒 <b>Ваша корзина:</b>\n\n',
    askNote: '✍️ Напишите общий комментарий к заказу (например, номер дома, ориентир):',
    skipNote: '⏭ Продолжить без комментария',
    paymentChoice: '\n💰 <b>Итого:</b> {total} сум\n\nВыберите способ оплаты:',
    payCash: '💵 Наличные',
    payCard: '💳 Картой',
    orderDoneBot: (id, pay) => `🎉 <b>Ваш заказ успешно принят!</b>\n\n🧾 ID заказа: #${id}\n${pay}\n\nСкоро с вами свяжутся наши сотрудники.`,
    cash: '💵 Наличными: оплата курьеру при получении.',
    card: (n, o, r) => `💳 Оплата картой${n ? `:\n<code>${n}</code>${o ? ` (${o})` : ''}` : ''}\nПосле перевода отправьте чек ${r || 'нам'} в Telegram.`,
    status: (id, s) => `🧾 Заказ #${id}: ${s}`, 
    rate: 'Понравилось обслуживание? Оцените 👇',
    thanksRate: (n) => `Спасибо! Вы поставили ${n}⭐.\nЕсли хотите, напишите отзыв сюда 💬`,
    already2: 'Вы уже оценили заказ', thanks: 'Спасибо!', commentOk: '🙏 Ваш отзыв принят, спасибо!',
  },
  en: {
    chooseLang: '🇬🇧 Please choose a language:',
    share: '📱 Share my number',
    askPhone: '📱 Please share your phone number 👇',
    ownNum: 'Please share only your own number.',
    askLocation: '📍 Please share your location to determine the delivery address 👇',
    shareLoc: '📍 Share location',
    categoriesTitle: '📂 Choose a category:',
    emptyCart: '⚠️ Your cart is empty!',
    cartHeader: '🛒 <b>Your cart:</b>\n\n',
    askNote: '✍️ Write a general comment for the order (e.g., apartment number, landmark):',
    skipNote: '⏭ Skip comment',
    paymentChoice: '\n💰 <b>Total:</b> {total} UZS\n\nChoose payment method:',
    payCash: '💵 Cash',
    payCard: '💳 Card',
    orderDoneBot: (id, pay) => `🎉 <b>Your order has been successfully accepted!</b>\n\n🧾 Order ID: #${id}\n${pay}\n\nOur staff will contact you shortly.`,
    cash: '💵 Cash: pay the courier on delivery.',
    card: (n, o, r) => `💳 Card payment${n ? `:\n<code>${n}</code>${o ? ` (${o})` : ''}` : ''}\nAfter the transfer, please send the receipt to ${r || 'us'} on Telegram.`,
    status: (id, s) => `🧾 Order #${id}: ${s}`, 
    rate: 'Did you like our service? Rate us 👇',
    thanksRate: (n) => `Thank you! You gave ${n}⭐.\nIf you like, write your comment here 💬`,
    already2: 'You have already rated this order', thanks: 'Thank you!', commentOk: '🙏 Your comment was received, thank you!',
  },
  hi: {
    chooseLang: '🇮🇳 कृपया भाषा चुनें:',
    share: '📱 नंबर साझा करें',
    askPhone: '📱 कृपया अपना फ़ोन नंबर साझा करें 👇',
    ownNum: 'कृपया केवल अपना ही नंबर साझा करें।',
    askLocation: '📍 अब कृपया डिलीवरी का पता तय करने के लिए अपना स्थान साझा करें 👇',
    shareLoc: '📍 स्थान साझा करें',
    categoriesTitle: '📂 श्रेणी चुनें:',
    emptyCart: '⚠️ आपकी कार्ट खाली है!',
    cartHeader: '🛒 <b>आपकी कार्ट:</b>\n\n',
    askNote: '✍️ ऑर्डर के लिए एक सामान्य टिप्पणी लिखें (जैसे, घर का नंबर):',
    skipNote: '⏭ टिप्पणी छोड़े',
    paymentChoice: '\n💰 <b>कुल:</b> {total} сум\n\nभुगतान का तरीका चुनें:',
    payCash: '💵 नकद',
    payCard: '💳 कार्ड',
    orderDoneBot: (id, pay) => `🎉 <b>आपका ऑर्डर सफलतापूर्वक स्वीकार कर लिया गया है!</b>\n\n🧾 ऑर्डर आईडी: #${id}\n${pay}\n\nहमारे कर्मचारी जल्द ही आपसे संपर्क करेंगे।`,
    cash: '💵 नकद: डिलीवरी पर कूरियर को भुगतान करें।',
    card: (n, o, r) => `💳 कार्ड से भुगतान${n ? `:\n<code>${n}</code>${o ? ` (${o})` : ''}` : ''}\nट्रांसफ़र के बाद रसीद Telegram पर ${r || 'हमें'} को भेजें।`,
    status: (id, s) => `🧾 ऑर्डर #${id}: ${s}`, 
    rate: 'हमारी सेवा कैसी लगी? रेटिंग दें 👇',
    thanksRate: (n) => `धन्यवाद! आपने ${n}⭐ रेटिंग दी。\nचाहें तो अपनी टिप्पणी यहाँ लिखें 💬`,
    already2: 'आप पहले ही रेटिंग दे चुके हैं', thanks: 'धन्यवाद!', commentOk: '🙏 आपकी टिप्पणी मिल गई, धन्यवाद!',
  },
};

const setPublic = (id, key) => db.ref('orders/' + id).update({ status: STATUS[key], statusKey: key });

const SEED = JSON.parse(fs.readFileSync('./menu.json', 'utf8'));
let LIVE = {};
db.ref('menu/items').on('value', (s) => { LIVE = s.val() || {}; });
const findItem = (i) => {
  if (Object.keys(LIVE).length) {
    const it = LIVE[i.id] || Object.values(LIVE).find((v) => v.name === i.name);
    return it && it.available !== false ? it : null;
  }
  return SEED.items.find((m) => m.id === i.id || m.name === i.name) || null;
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
  (o.note ? `📝 Izoh: ${esc(o.note)}\n` : '') +
  `💳 To'lov: ${o.payment === 'card' ? 'Karta' : 'Naqd'}\n\n` +
  o.items.map((i, n) => `${n + 1}. ${esc(i.name)} × ${i.qty} = ${fmt(i.price * i.qty)}${i.itemNote ? ` (Izoh: ${esc(i.itemNote)})` : ''}`).join('\n') +
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

app.get('/', (_, res) => res.status(200).send('Garden Food API ishlayapti'));

const rate = new Map();
app.post('/api/order', async (req, res) => {
  try {
    const hits = (rate.get(req.ip) || []).filter((t) => Date.now() - t < 3600000);
    if (hits.length >= 10) return res.json({ status: 'error', message: "Juda ko'p urinish" });
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
    await db.ref('ordersPrivate/' + id).set(o);
    await setPublic(id, 'unconfirmed');
    rate.set(req.ip, [...hits, Date.now()]);
    res.json({ status: 'ok', orderId: id, botLink: `https://t.me/${BOT_USERNAME}?start=${id}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

// Saytdan yuborilgan baholarni qabul qiluvchi API
app.post('/api/review', async (req, res) => {
  try {
    const { orderId, rating, comment } = req.body || {};
    if (!orderId || !rating) return res.json({ status: 'error', message: "Ma'lumot yetarli emas" });

    const ordRef = db.ref('ordersPrivate/' + orderId);
    const ord = (await ordRef.get()).val();

    await ordRef.update({ rating, comment: comment || '' });
    if (db.ref('orders/' + orderId)) {
      await db.ref('orders/' + orderId).update({ rating, comment: comment || '' });
    }

    const clientName = ord ? esc(ord.name) : 'Mijoz';
    const clientPhone = ord && ord.phone ? `+${esc(ord.phone)}` : 'Nomaʼlum';
    const starsText = '⭐'.repeat(Number(rating) || 5);
    
    let msg = `⭐ <b>Yangi baho va izoh!</b>\n\n🧾 Buyurtma: #${orderId}\n👤 Mijoz: ${clientName}\n📞 Tel: ${clientPhone}\n<b>Baho:</b> ${starsText} (${rating}/5)`;
    if (comment) {
      msg += `\n💬 <b>Izoh:</b> ${esc(comment)}`;
    }
    await send(ADMIN_CHAT_ID, msg);

    res.json({ status: 'ok' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

// ---------- ADMIN API (Admin panel uchun) ----------
const hmac = (s) => crypto.createHmac('sha256', TOKEN_SECRET).update(s).digest('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const adminAuth = (req, res, next) => {
  const [exp, sig] = (req.headers.authorization || '').replace('Bearer ', '').split('.');
  if (!exp || !sig || Number(exp) < Date.now() || !same(sig, hmac('admin.' + exp))) {
    return res.status(401).json({ status: 'error', message: "Ruxsat yo'q" });
  }
  next();
};

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.json({ status: 'error', message: "Parol noto'g'ri" });
  }
  const exp = Date.now() + 86400000; // 1 kun
  const sig = hmac('admin.' + exp);
  res.json({ status: 'ok', token: `${exp}.${sig}` });
});

app.get('/api/admin/menu', adminAuth, async (req, res) => {
  try {
    const snap = (await db.ref('menu').get()).val() || { categories: Object.keys(MENU), items: {} };
    res.json({ status: 'ok', menu: snap });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

app.put('/api/admin/categories', adminAuth, async (req, res) => {
  try {
    const categories = (req.body.categories || []).map(c => c.trim()).filter(Boolean);
    await db.ref('menu/categories').set(categories);
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

app.get('/api/admin/reviews', adminAuth, async (req, res) => {
  try {
    const snap = (await db.ref('ordersPrivate').get()).val() || {};
    const list = Object.values(snap)
      .filter(o => o.rating)
      .map(o => ({ id: o.id, name: o.name, rating: o.rating, comment: o.comment, createdAt: o.createdAt || Date.now() }))
      .sort((a, b) => b.createdAt - a.createdAt);
    
    const count = list.length;
    const avg = count ? (list.reduce((s, r) => s + r.rating, 0) / count).toFixed(1) : 0;
    res.json({ status: 'ok', list, count, avg });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

app.post('/api/admin/seed', adminAuth, async (req, res) => {
  try {
    const builtinItems = Object.entries(MENU).flatMap(([cat, c]) => 
      c.list.map((it, n) => ({ 
        id: it.img.replace(/^images\//, "").replace(/\.jpg$/, ""), 
        category: cat, 
        name: it.name, 
        price: it.price, 
        img: it.img, 
        sort: n, 
        available: true 
      }))
    );
    const itemsObj = Object.fromEntries(builtinItems.map(i => [i.id, i]));
    const cats = Object.keys(MENU);
    await db.ref('menu').set({ categories: cats, items: itemsObj });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

app.post('/api/admin/item', adminAuth, async (req, res) => {
  try {
    const { name, price, category, img, available } = req.body || {};
    if (!name || !price) return res.json({ status: 'error', message: "Ma'lumotlar yetarli emas" });
    const id = 'it-' + crypto.randomBytes(3).toString('hex');
    const item = { name: name.trim(), price: Number(price), category: category || 'Asosiy', img: img || '', available: available !== false };
    await db.ref('menu/items/' + id).set(item);
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

app.put('/api/admin/item/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, price, category, img, available } = req.body || {};
    await db.ref('menu/items/' + id).update({ 
      name: name.trim(), 
      price: Number(price), 
      category, 
      img: img || '', 
      available: available !== false 
    });
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

app.delete('/api/admin/item/:id', adminAuth, async (req, res) => {
  try {
    await db.ref('menu/items/' + req.params.id).remove();
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: 'Server xatosi' });
  }
});

// ---------- TELEGRAM BOT ----------
const botSessions = {}; 

async function confirmOrderFromWeb(o, chat, phone, from) {
  const upd = { status: 'pending', phone, chatId: chat, username: from.username || null, confirmedAt: Date.now() };
  Object.assign(o, upd);
  await db.ref('ordersPrivate/' + o.id).update(upd);
  await setPublic(o.id, 'pending');
  await db.ref('users/' + chat).set({ phone });
  await db.ref('pending/' + chat).remove();
  await send(chat, B[lg(o.lang)].confirmed(o.id, payNote(o)), { reply_markup: { remove_keyboard: true } });
  await send(ADMIN_CHAT_ID, orderText(o), { reply_markup: keyboard(o) });
}

async function onStart(m, orderId) {
  const chat = m.chat.id;
  botSessions[chat] = { cart: {}, orderId: orderId || null, step: 'choosing_lang' };

  const langMarkup = {
    inline_keyboard: [
      [{ text: "🇺🇿 O'zbekcha", callback_data: "lang:uz" }, { text: "🇷🇺 Русский", callback_data: "lang:ru" }],
      [{ text: "🇬🇧 English", callback_data: "lang:en" }, { text: "🇮🇳 हिन्दी", callback_data: "lang:hi" }]
    ]
  };

  await send(chat, B.uz.chooseLang, { 
    reply_markup: { 
      ...langMarkup,
      remove_keyboard: true 
    } 
  });
}

async function askPhoneStep(chat) {
  const session = botSessions[chat];
  const T = B[session.lang];
  session.step = 'waiting_phone';
  await send(chat, T.askPhone, {
    reply_markup: { keyboard: [[{ text: T.share, request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
  });
}

async function askLocationStep(chat) {
  const session = botSessions[chat];
  const T = B[session.lang];
  session.step = 'waiting_location';
  await send(chat, T.askLocation, {
    reply_markup: { keyboard: [[{ text: T.shareLoc, request_location: true }]], resize_keyboard: true, one_time_keyboard: true },
  });
}

async function showCategories(chat) {
  const session = botSessions[chat];
  session.step = 'categories';
  const T = B[session.lang];

  const itemsObj = Object.keys(LIVE).length ? LIVE : SEED.items;
  const categories = [...new Set(Object.values(itemsObj).map(i => i.category || 'Asosiy'))];

  let inlineKeyboard = [];
  for (const cat of categories) {
    inlineKeyboard.push([{ text: `📂 ${cat}`, callback_data: `cat:${cat}` }]);
  }
  inlineKeyboard.push([{ text: "🛒 Savatchani ko'rish", callback_data: "view_cart" }]);

  await send(chat, T.categoriesTitle, { 
    reply_markup: { 
      inline_keyboard: inlineKeyboard, 
      remove_keyboard: true 
    } 
  });
}

async function showCategoryItems(chat, categoryName) {
  const session = botSessions[chat];
  session.step = 'category_items';
  const itemsObj = Object.keys(LIVE).length ? LIVE : SEED.items;

  for (const [key, item] of Object.entries(itemsObj)) {
    if (item.available === false) continue;
    if ((item.category || 'Asosiy') !== categoryName) continue;

    const desc = item.description ? `\n📝 <b>Tarkibi:</b> ${esc(item.description)}` : '';
    const caption = `<b>${esc(item.name)}</b>${desc}\n💰 <b>Narxi:</b> ${fmt(item.price)} so'm`;

    const itemKeyboard = {
      inline_keyboard: [
        [
          { text: "➕ Qo'shish", callback_data: `add_item:${key}` },
          { text: "✍️ Izoh yozish", callback_data: `note_item:${key}` }
        ]
      ]
    };

    if (item.img && item.img.startsWith('http')) {
      try {
        await tg('sendPhoto', {
          chat_id: chat,
          photo: item.img,
          caption: caption,
          parse_mode: 'HTML',
          reply_markup: itemKeyboard
        });
      } catch (err) {
        await send(chat, caption, { reply_markup: itemKeyboard });
      }
    } else {
      await send(chat, caption, { reply_markup: itemKeyboard });
    }
  }

  await send(chat, "Boshqa kategoriyani tanlang yoki savatchaga o'ting:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "📂 Kategoriyaga qaytish", callback_data: "back_categories" }],
        [{ text: "🛒 Savatchani ko'rish / Rasmiylashtirish", callback_data: "view_cart" }]
      ]
    }
  });
}

async function onMessage(m) {
  if (m.chat.type !== 'private') return;
  const chat = m.chat.id;
  const session = botSessions[chat] || { lang: 'uz', cart: {} };
  const T = B[session.lang];

  if (m.text?.startsWith('/start') || m.text === "🛍 Qaytadan buyurtma berish") {
    const parts = m.text.split(' ');
    const id = parts[1] ? parts[1].trim() : null;
    return onStart(m, id);
  }

  if (m.contact && session.step === 'waiting_phone') {
    if (m.contact.user_id !== m.from.id) return send(chat, T.ownNum);
    const phone = String(m.contact.phone_number).replace(/\D/g, '');
    session.phone = phone;
    await db.ref('users/' + chat).set({ phone });

    if (session.orderId) {
      const o = (await db.ref('ordersPrivate/' + session.orderId).get()).val();
      if (o && o.status === 'unconfirmed') return confirmOrderFromWeb(o, chat, phone, m.from);
    }
    return askLocationStep(chat);
  }

  if (m.location && session.step === 'waiting_location') {
    session.location = { lat: m.location.latitude, lng: m.location.longitude };
    return showCategories(chat);
  }

  if (m.text && session.step === 'waiting_item_note') {
    const itemId = session.pendingItemNote;
    if (itemId) {
      session.cart[itemId] = session.cart[itemId] || { qty: 1, note: '' };
      session.cart[itemId].note = m.text.trim().slice(0, 200);
      await send(chat, "✅ Mahsulotga izoh saqlandi!");
    }
    session.step = 'categories';
    return showCategories(chat);
  }

  if (m.text && session.step === 'waiting_order_note') {
    session.orderNote = m.text.trim().slice(0, 300);
    return finalizeOrderProcess(chat);
  }

  if (m.text && !m.text.startsWith('/')) {
    const oid = (await db.ref('reviewPending/' + chat).get()).val();
    if (oid) {
      await db.ref('reviewPending/' + chat).remove();
      const ord = (await db.ref('ordersPrivate/' + oid).get()).val();

      await db.ref('ordersPrivate/' + oid).update({ comment: m.text.trim() });
      if (db.ref('orders/' + oid)) {
        await db.ref('orders/' + oid).update({ comment: m.text.trim() });
      }

      const clientName = ord ? esc(ord.name) : 'Mijoz';
      const clientPhone = ord && ord.phone ? `+${esc(ord.phone)}` : 'Nomaʼlum';
      const userRating = ord && ord.rating ? `${'⭐'.repeat(ord.rating)} (${ord.rating}/5)` : 'Baho berilmagan';

      await send(ADMIN_CHAT_ID, `💬 <b>Mijozdan yangi izoh!</b>\n\n🧾 Buyurtma: #${oid}\n👤 Mijoz: ${clientName}\n📞 Tel: ${clientPhone}\nBaho: ${userRating}\n\n<b>Izoh matni:</b> ${esc(m.text.trim())}`);

      botSessions[chat] = { lang: ord?.lang || 'uz', cart: {} };
      await send(chat, T.commentOk, {
        reply_markup: {
          keyboard: [[{ text: "🛍 Qaytadan buyurtma berish" }]],
          resize_keyboard: true,
          one_time_keyboard: false
        }
      });
      return;
    }
  }
}

async function onCallback(cb) {
  const chat = cb.message?.chat?.id;
  const session = botSessions[chat] || { lang: 'uz', cart: {} };
  const T = B[session.lang];

  if (cb.data?.startsWith('lang:')) {
    const chosenLang = cb.data.replace('lang:', '');
    session.lang = chosenLang;
    await tg('answerCallbackQuery', { callback_query_id: cb.id });

    const known = (await db.ref('users/' + chat).get()).val();
    if (known?.phone) {
      session.phone = known.phone;
      if (session.orderId) {
        const o = (await db.ref('ordersPrivate/' + session.orderId).get()).val();
        if (o && o.status === 'unconfirmed') {
          return confirmOrderFromWeb(o, chat, known.phone, cb.from);
        }
      }
      return askLocationStep(chat);
    }
    return askPhoneStep(chat);
  }

  if (cb.data?.startsWith('cat:')) {
    const catName = cb.data.replace('cat:', '');
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    return showCategoryItems(chat, catName);
  }

  if (cb.data === 'back_categories') {
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    return showCategories(chat);
  }

  if (cb.data?.startsWith('add_item:')) {
    const itemId = cb.data.replace('add_item:', '');
    if (!session.cart[itemId]) session.cart[itemId] = { qty: 1, note: '' };
    else session.cart[itemId].qty += 1;

    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: '✅ Savatchaga qo\'shildi' });
    return;
  }

  if (cb.data?.startsWith('note_item:')) {
    const itemId = cb.data.replace('note_item:', '');
    session.pendingItemNote = itemId;
    session.step = 'waiting_item_note';
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    return send(chat, "✍️ Ushbu mahsulot uchun izohingizni yuboring (masalan: piyoz bo'lmasin):");
  }

  if (cb.data === 'view_cart') {
    const cart = session.cart || {};
    const keys = Object.keys(cart);
    if (!keys.length) return tg('answerCallbackQuery', { callback_query_id: cb.id, text: T.emptyCart, show_alert: true });

    let text = T.cartHeader;
    let total = 0;
    const itemsObj = Object.keys(LIVE).length ? LIVE : SEED.items;

    let index = 1;
    for (const [itemId, data] of Object.entries(cart)) {
      const item = itemsObj[itemId];
      if (item) {
        const sum = item.price * data.qty;
        total += sum;
        text += `${index++}. ${item.name} x ${data.qty} = ${fmt(sum)} so'm${data.note ? `\n   └ <i>Izoh: ${esc(data.note)}</i>` : ''}\n`;
      }
    }

    text += T.paymentChoice.replace('{total}', fmt(total));
    const payKeyboard = {
      inline_keyboard: [
        [{ text: T.payCash, callback_data: 'pay_cash' }, { text: T.payCard, callback_data: 'pay_card' }],
        [{ text: '📂 Kategoriyaga qaytish', callback_data: 'back_categories' }]
      ]
    };

    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    return tg('editMessageText', { chat_id: chat, message_id: cb.message.message_id, text, parse_mode: 'HTML', reply_markup: payKeyboard });
  }

  if (cb.data?.startsWith('pay_')) {
    session.paymentType = cb.data === 'pay_cash' ? 'cash' : 'card';
    session.step = 'waiting_order_note';
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    return send(chat, T.askNote, {
      reply_markup: { inline_keyboard: [[{ text: T.skipNote, callback_data: 'skip_note' }]] }
    });
  }

  if (cb.data === 'skip_note') {
    session.orderNote = '';
    await tg('answerCallbackQuery', { callback_query_id: cb.id });
    return finalizeOrderProcess(chat);
  }

  if (cb.data?.startsWith('rate:')) {
    const [, oid, n] = cb.data.split(':');
    const ordRef = db.ref('ordersPrivate/' + oid);
    const ord = (await ordRef.get()).val();
    if (!ord || String(ord.chatId) !== String(chat)) return tg('answerCallbackQuery', { callback_query_id: cb.id });

    await ordRef.update({ rating: Number(n) });
    if (db.ref('orders/' + oid)) {
      await db.ref('orders/' + oid).update({ rating: Number(n) });
    }

    await tg('answerCallbackQuery', { callback_query_id: cb.id, text: T.thanks });
    await db.ref('reviewPending/' + chat).set(oid);
    await tg('editMessageText', { chat_id: chat, message_id: cb.message.message_id, text: T.thanksRate(n) });

    const clientName = esc(ord.name || 'Mijoz');
    const clientPhone = ord.phone ? `+${esc(ord.phone)}` : 'Nomaʼlum';
    const starsText = '⭐'.repeat(Number(n));
    
    await send(ADMIN_CHAT_ID, `⭐ <b>Mijozdan yangi baho!</b>\n\n🧾 Buyurtma: #${oid}\n👤 Mijoz: ${clientName}\n📞 Tel: ${clientPhone}\n<b>Baho:</b> ${starsText} (${n}/5)`);

    await send(chat, "Xizmatingiz uchun rahmat! Agar xohlasangiz, izohingizni ham yozib qoldirishingiz mumkin:", {
      reply_markup: {
        keyboard: [[{ text: "🛍 Qaytadan buyurtma berish" }]],
        resize_keyboard: true,
        one_time_keyboard: false
      }
    });
    return;
  }

  const [id, status] = (cb.data || '').split(':');
  if (!id || !status) return;
  const ref = db.ref('ordersPrivate/' + id);
  const o = (await ref.get()).val();
  const ok = o && String(cb.message?.chat?.id) === String(ADMIN_CHAT_ID) && (NEXT[o.status] || []).includes(status);
  if (!ok) return tg('answerCallbackQuery', { callback_query_id: cb.id, text: 'Amal mumkin emas' });
  
  o.status = status;
  await ref.update({ status });
  await setPublic(id, status);
  await tg('answerCallbackQuery', { callback_query_id: cb.id, text: STATUS[status] });
  await tg('editMessageText', {
    chat_id: cb.message.chat.id,
    message_id: cb.message.message_id,
    text: orderText(o),
    parse_mode: 'HTML',
    reply_markup: keyboard(o),
  });
  if (o.chatId) send(o.chatId, B[lg(o.lang)].status(id, SL[lg(o.lang)][status])).catch(() => {});
  
  if (status === 'done' && o.chatId) {
    send(o.chatId, B[lg(o.lang)].rate, { reply_markup: { inline_keyboard: [[1, 2, 3, 4, 5].map((n) => ({ text: `${n}⭐`, callback_data: `rate:${id}:${n}` }))]} }).catch(() => {});
    
    await send(o.chatId, "Buyurtmangiz yetkazib berildi! Yana buyurtma bermoqchi bo'lsangiz pastdagi tugmani bosing 👇", {
      reply_markup: {
        keyboard: [[{ text: "🛍 Qaytadan buyurtma berish" }]],
        resize_keyboard: true,
        one_time_keyboard: false
      }
    });
  }
}

async function finalizeOrderProcess(chat) {
  const session = botSessions[chat];
  const T = B[session.lang];
  const cart = session.cart || {};
  const itemsObj = Object.keys(LIVE).length ? LIVE : SEED.items;

  let lines = [];
  let total = 0;
  for (const [itemId, data] of Object.entries(cart)) {
    const item = itemsObj[itemId];
    if (item) {
      lines.push({ name: item.name, qty: data.qty, price: Number(item.price), itemNote: data.note || '' });
      total += item.price * data.qty;
    }
  }

  const id = 'GF-' + crypto.randomBytes(3).toString('hex').toUpperCase();
  const orderObj = {
    id,
    name: 'Telegram Mijoz',
    address: 'Telegram Bot (Geolokatsiya)',
    items: lines,
    total,
    status: 'pending',
    createdAt: Date.now(),
    payment: session.paymentType,
    note: session.orderNote || 'Izoh yo\'q',
    lang: session.lang,
    location: session.location || null,
    phone: session.phone,
    chatId: chat,
  };

  await db.ref('ordersPrivate/' + id).set(orderObj);
  await setPublic(id, 'pending');

  session.cart = {};

  await send(chat, T.orderDoneBot(id, session.paymentType === 'card' ? payNote(orderObj) : T.cash), { parse_mode: 'HTML' });
  await send(ADMIN_CHAT_ID, orderText(orderObj), { reply_markup: keyboard(orderObj) });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`GardenFood Backend serveri ${PORT}-portda muvaffaqiyatli ishga tushdi!`);
});
