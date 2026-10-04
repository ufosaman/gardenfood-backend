const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_DB_URL = "https://gardenfoodsam-default-rtdb.firebaseio.com";

// Bekor qilish izohini kutish xotirasi
const pendingCancellations = {};

app.post("/telegram-webhook", async (req, res) => {
  try {
    const update = req.body;

    // 1. INLINE TUGMALAR BOSILGANDA
    if (update.callback_query) {
      const callback = update.callback_query;
      const callbackData = callback.data || "";
      const chatId = callback.message.chat.id;
      const messageId = callback.message.message_id;

      let orderId = "";
      let action = "";

      if (callbackData.includes(":")) {
        [orderId, action] = callbackData.split(":");
      }

      // A) QABUL QILINDI (TAYYORLANMOQDA)
      if (action === "accept") {
        await axios.patch(`${FIREBASE_DB_URL}/orders/${orderId}.json`, {
          status: "👨‍🍳 Buyurtma qabul qilindi va tayyorlanmoqda",
          updatedAt: Date.now()
        });

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: messageId,
          text: callback.message.text + "\n\n<b>Status:</b> 👨‍🍳 Tayyorlanmoqda...",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [
                { text: "🚗 Yo'lga chiqdi", callback_data: `${orderId}:delivering` },
                { text: "✅ Yetkazildi", callback_data: `${orderId}:completed` }
              ],
              [
                { text: "❌ Bekor qilish", callback_data: `${orderId}:cancel` }
              ]
            ]
          }
        });
      } 

      // B) YO'LGA CHIQDI
      else if (action === "delivering") {
        await axios.patch(`${FIREBASE_DB_URL}/orders/${orderId}.json`, {
          status: "🚗 Kuryer yo'lda, tez orada yetib boradi",
          updatedAt: Date.now()
        });

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: messageId,
          text: callback.message.text.split("\n\n<b>Status:</b>")[0] + "\n\n<b>Status:</b> 🚗 Yo'lda...",
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: "✅ Yetkazildi", callback_data: `${orderId}:completed` }]
            ]
          }
        });
      }

      // C) YETKAZILDI (MUKAMMAL YAKUNLANDI)
      else if (action === "completed") {
        await axios.patch(`${FIREBASE_DB_URL}/orders/${orderId}.json`, {
          status: "🎉 Buyurtma muvaffaqiyatli yetkazib berildi!",
          updatedAt: Date.now()
        });

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: messageId,
          text: callback.message.text.split("\n\n<b>Status:</b>")[0] + "\n\n✅ <b>BUYURTMA YETKAZIB BERILDI!</b>",
          parse_mode: "HTML"
        });
      }

      // D) BEKOR QILISH
      else if (action === "cancel") {
        const promptRes = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: `❌ Buyurtma #${orderId} ni bekor qilish sababini ushbu xabarga javob (reply) qilib yozing:`,
          reply_markup: { force_reply: true }
        });

        pendingCancellations[chatId] = {
          orderId: orderId,
          originalMessageId: messageId,
          promptMessageId: promptRes.data.result.message_id
        };
      }

      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: callback.id
      });
    }

    // 2. ADMIN BEKOR QILISH SABABINI REPLY QILIB YOZGANIDA
    if (update.message && update.message.reply_to_message) {
      const chatId = update.message.chat.id;
      const pending = pendingCancellations[chatId];

      if (pending && update.message.reply_to_message.message_id === pending.promptMessageId) {
        const reason = update.message.text;

        await axios.patch(`${FIREBASE_DB_URL}/orders/${pending.orderId}.json`, {
          status: `❌ Bekor qilindi. Sababi: ${reason}`,
          cancelReason: reason,
          updatedAt: Date.now()
        });

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: pending.originalMessageId,
          text: update.message.reply_to_message.text.split('\n\n')[0] + `\n\n❌ <b>BUYURTMA BEKOR QILINDI!</b>\n<b>Sababi:</b> ${reason}`,
          parse_mode: "HTML"
        });

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: `✅ Buyurtma #${pending.orderId} bekor qilindi va mijozga yetkazildi.`
        });

        delete pendingCancellations[chatId];
      }
    }

  } catch (err) {
    console.error("Webhook Error:", err.message);
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => res.send("Garden Food Backend Server Ishlamoqda!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
