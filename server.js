const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_DB_URL = "https://gardenfoodsam-default-rtdb.firebaseio.com";

// Bekor qilish izohini kutish xotirasi
const pendingCancellations = {};

app.post("/telegram-webhook", async (req, res) => {
  const update = req.body;

  // 1. Inline tugma bosilganda (Callback query)
  if (update.callback_query) {
    const callback = update.callback_query;
    const [orderId, action] = callback.data.split(":");
    const chatId = callback.message.chat.id;
    const messageId = callback.message.message_id;

    if (action === "accept") {
      try {
        // Firebase bazada holatni yangilash
        await axios.patch(`${FIREBASE_DB_URL}/orders/${orderId}.json`, {
          status: "✅ Qabul qilindi",
          updatedAt: Date.now()
        });

        // Telegram xabarni yangilash (Tugmalarni olib tashlash)
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: messageId,
          text: callback.message.text + "\n\n✅ <b>BUYURTMA QABUL QILINDI!</b>",
          parse_mode: "HTML"
        });

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          callback_query_id: callback.id,
          text: `Buyurtma #${orderId} qabul qilindi!`
        });
      } catch (err) {
        console.error("Xatolik (accept):", err.message);
      }
    } 
    else if (action === "cancel") {
      try {
        // Admin izoh yozishi uchun ForceReply yuborish
        const response = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          chat_id: chatId,
          text: `❌ Buyurtma #${orderId} ni bekor qilish sababini ushbu xabarga javob (reply) qilib yozing:`,
          reply_markup: { force_reply: true }
        });

        pendingCancellations[chatId] = {
          orderId: orderId,
          originalMessageId: messageId,
          promptMessageId: response.data.result.message_id
        };

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          callback_query_id: callback.id
        });
      } catch (err) {
        console.error("Xatolik (cancel):", err.message);
      }
    }
  }

  // 2. Admin sababini reply qilib yozib yuborganda
  if (update.message && update.message.reply_to_message) {
    const chatId = update.message.chat.id;
    const pending = pendingCancellations[chatId];

    if (pending && update.message.reply_to_message.message_id === pending.promptMessageId) {
      const reason = update.message.text;

      try {
        // Firebase bazada holatni yangilash
        await axios.patch(`${FIREBASE_DB_URL}/orders/${pending.orderId}.json`, {
          status: `❌ Bekor qilindi (${reason})`,
          updatedAt: Date.now()
        });

        // Asosiy buyurtma xabarini yangilash
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: pending.originalMessageId,
          text: `❌ <b>BUYURTMA BEKOR QILINDI!</b>\n<b>Sababi:</b> ${reason}`,
          parse_mode: "HTML"
        });

        delete pendingCancellations[chatId];
      } catch (err) {
        console.error("Xatolik (reply):", err.message);
      }
    }
  }

  res.sendStatus(200);
});

app.get("/", (req, res) => {
  res.send("Garden Food Backend Server Ishlamoqda!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});
