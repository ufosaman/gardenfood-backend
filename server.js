const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_DB_URL = "https://gardenfoodsam-default-rtdb.firebaseio.com";

// Bekor qilish izohini kutish xotirasi (Chat ID bo'yicha)
const pendingCancellations = {};

app.post("/telegram-webhook", async (req, res) => {
  try {
    const update = req.body;
    console.log("Webhook keldi:", JSON.stringify(update));

    // 1. INLINE TUGMA BOSILGANDA
    if (update.callback_query) {
      const callback = update.callback_query;
      const callbackData = callback.data || "";
      const chatId = callback.message.chat.id;
      const messageId = callback.message.message_id;

      // "orderId:action" yoki "accept_orderId" formatlarini ajratish
      let orderId = "";
      let action = "";

      if (callbackData.includes(":")) {
        [orderId, action] = callbackData.split(":");
      } else if (callbackData.startsWith("accept_")) {
        orderId = callbackData.replace("accept_", "");
        action = "accept";
      } else if (callbackData.startsWith("cancel_")) {
        orderId = callbackData.replace("cancel_", "");
        action = "cancel";
      }

      console.log(`Tugma bosildi. Action: ${action}, OrderId: ${orderId}`);

      // A) QABUL QILINDI
      if (action === "accept") {
        try {
          await axios.patch(`${FIREBASE_DB_URL}/orders/${orderId}.json`, {
            status: "✅ Qabul qilindi",
            updatedAt: Date.now()
          });
        } catch (e) {
          console.error("Firebase update error:", e.message);
        }

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
      } 

      // B) BEKOR QILISH
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

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
          callback_query_id: callback.id
        });
      }
    }

    // 2. ADMIN SABABINI REPLIK QILIB YOZIB YUBORGANDA
    if (update.message && update.message.reply_to_message) {
      const chatId = update.message.chat.id;
      const pending = pendingCancellations[chatId];

      if (pending && update.message.reply_to_message.message_id === pending.promptMessageId) {
        const reason = update.message.text;

        try {
          await axios.patch(`${FIREBASE_DB_URL}/orders/${pending.orderId}.json`, {
            status: `❌ Bekor qilindi. Sababi: ${reason}`,
            cancelReason: reason,
            updatedAt: Date.now()
          });
        } catch (e) {
          console.error("Firebase update error:", e.message);
        }

        const originalText = update.message.reply_to_message.text || "";
        const cleanText = originalText.replace(/^❌ Buyurtma #.*$/m, "").trim();

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
          chat_id: chatId,
          message_id: pending.originalMessageId,
          text: `${cleanText}\n\n❌ <b>BUYURTMA BEKOR QILINDI!</b>\n<b>Sababi:</b> ${reason}`,
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
    console.error("Webhook xatolik:", err.response ? err.response.data : err.message);
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
