const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch'); // Telegram API bilan ishlash uchun

const app = express();
app.use(cors());
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID; // yoki administrator chat ID si

// Bekor qilish sababini kutayotgan holatlarni saqlash uchun (vaqtinchalik xotira)
const pendingCancellations = {};

// 1. Saytdan yangi buyurtma kelganda
app.post('/send-order', async (req, res) => {
    try {
        const order = req.body;
        const { orderId, items, totalPrice, customerName, phone, address, paymentMethod } = order;

        let itemsText = items.map(item => `- ${item.title} x ${item.quantity} (${item.price * item.quantity} so'm)`).join('\n');

        let messageText = `📦 <b>YANGI BUYURTMA #${orderId}</b>\n\n` +
            `👤 <b>Mijoz:</b> ${customerName}\n` +
            `📞 <b>Tel:</b> ${phone}\n` +
            `📍 <b>Manzil:</b> ${address}\n` +
            `💳 <b>To'lov turi:</b> ${paymentMethod}\n\n` +
            `<b>Tarkibi:</b>\n${itemsText}\n\n` +
            `💰 <b>Jami:</b> ${totalPrice} so'm`;

        // Inline tugmalar
        const inlineKeyboard = {
            inline_keyboard: [
                [
                    { text: "✅ Qabul qilindi", callback_data: `accept_${orderId}` },
                    { text: "❌ Bekor qilish", callback_data: `cancel_${orderId}` }
                ]
            ]
        };

        const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: ADMIN_CHAT_ID,
                text: messageText,
                parse_mode: 'HTML',
                reply_markup: inlineKeyboard
            })
        });

        const data = await response.json();
        if (data.ok) {
            res.json({ success: true, message: "Buyurtma yuborildi" });
        } else {
            res.status(500).json({ success: false, error: data.description });
        }
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Telegram Webhook (Tugmalar bosilganda yoki xabar kelganda)
app.post('/telegram-webhook', async (req, res) => {
    const update = req.body;

    // A) Inline tugma bosilganda (Callback Query)
    if (update.callback_query) {
        const query = update.callback_query;
        const data = query.data;
        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        if (data.startsWith('accept_')) {
            const orderId = data.replace('accept_', '');

            // Xabarni yangilash (Tugmalarni olib tashlash va holatni o'zgartirish)
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_id: messageId,
                    text: query.message.text + `\n\n✅ <b>BUYURTMA QABUL QILINDI!</b>`,
                    parse_mode: 'HTML'
                })
            });

            // Telegram'da bildirishnoma ko'rsatish
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: query.id, text: `Buyurtma #${orderId} qabul qilindi!` })
            });
        } 
        else if (data.startsWith('cancel_')) {
            const orderId = data.replace('cancel_', '');

            // Admin bekor qilish sababini yozishi uchun taklif yuboramiz (ForceReply)
            const replyMsg = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: `❌ Buyurtma #${orderId} bekor qilish sababini ushbu xabarga javob (reply) qilib yozing:`,
                    reply_markup: { force_reply: true }
                })
            });

            const replyData = await replyMsg.json();

            // Kutish ro'yxatiga qo'shamiz
            pendingCancellations[chatId] = {
                orderId: orderId,
                originalMessageId: messageId,
                promptMessageId: replyData.result.message_id
            };

            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ callback_query_id: query.id })
            });
        }
    }

    // B) Admin sababni yozib yuborganda (Reply message)
    if (update.message && update.message.reply_to_message) {
        const chatId = update.message.chat.id;
        const pending = pendingCancellations[chatId];

        if (pending && update.message.reply_to_message.message_id === pending.promptMessageId) {
            const cancelReason = update.message.text;

            // Asosiy buyurtma xabarini bekor qilingan deb o'zgartiramiz
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    message_id: pending.originalMessageId,
                    text: `❌ <b>BUYURTMA BEKOR QILINDI!</b>\n<b>Sababi:</b> ${cancelReason}`,
                    parse_mode: 'HTML'
                })
            });

            // Tasdiq xabari
            await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: ` Buyurtma #${pending.orderId} bekor qilindi va sababi saqlandi.`
                })
            });

            // Holatni tozalaymiz
            delete pendingCancellations[chatId];
        }
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
