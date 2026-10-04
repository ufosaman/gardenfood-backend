const express = require("express");
const axios = require("axios");
const app = express();

app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const FIREBASE_DB_URL = "https://gardenfoodsam-default-rtdb.firebaseio.com";

app.post("/telegram-webhook", async (req, res) => {
  const update = req.body;

  if (update.callback_query) {
    const callback = update.callback_query;
    const [orderId, status] = callback.data.split(":"); 

    let statusText = "";
    if (status === "preparing") statusText = "👨‍🍳 Tayyorlanmoqda";
    if (status === "shipping") statusText = "🛵 Kurerda / Yo'lda";
    if (status === "delivered") statusText = "✅ Yetkazib berildi";

    try {
      // 1. Firebase'da buyurtma holatini yangilash
      await axios.patch(`${FIREBASE_DB_URL}/orders/${orderId}.json`, {
        status: statusText,
        updatedAt: Date.now()
      });

      // 2. Telegram bildirishnoma qaytarish
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
        callback_query_id: callback.id,
        text: `Holat o'zgartirildi: ${statusText}`
      });

      // 3. Telegram chatingizdagi tugmalarni yangilash
      await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageReplyMarkup`, {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        reply_markup: {
          inline_keyboard: [
            [
              { text: status === "preparing" ? "✅ 👨‍🍳 Tayyorlanmoqda" : "👨‍🍳 Tayyorlanmoqda", callback_data: `${orderId}:preparing` },
              { text: status === "shipping" ? "✅ 🛵 Kurerda" : "🛵 Kurerda", callback_data: `${orderId}:shipping` }
            ],
            [
              { text: status === "delivered" ? "✅ Yetkazib berildi" : "✅ Yetkazib berildi", callback_data: `${orderId}:delivered` }
            ]
          ]
        }
      });
    } catch (err) {
      console.error("Xatolik:", err.message);
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
