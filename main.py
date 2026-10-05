import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests

app = FastAPI()

# 1. CORS sozlamasi
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class OrderData(BaseModel):
  orderId: str
  text: str


BOT_TOKEN = os.getenv("BOT_TOKEN")
CHAT_ID = "8757414683"  # Telegram CHAT_ID


@app.get("/")
def home():
  return {"status": "Garden Food Backend ishlayapti!"}


# Saytdan buyurtma yuborish
@app.post("/api/order")
async def send_order(data: OrderData):
  url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
  payload = {
      "chat_id": CHAT_ID,
      "text": data.text,
      "parse_mode": "HTML",
      "reply_markup": {
          "inline_keyboard": [[
              {
                  "text": "✅ Qabul qilish",
                  "callback_data": f"accept:{data.orderId}",
              },
              {
                  "text": "❌ Bekor qilish",
                  "callback_data": f"cancel:{data.orderId}",
              },
          ]]
      },
  }
  res = requests.post(url, json=payload)
  return {"status": "ok", "telegram_response": res.json()}


# Telegram tugmalari bosilganda keladigan so'rovni ushlash (Webhook)
@app.post("/api/telegram-webhook")
async def telegram_webhook(request: Request):
  data = await request.json()

  if "callback_query" in data:
    callback = data["callback_query"]
    callback_id = callback["id"]
    callback_data = callback.get("data", "")
    message = callback.get("message", {})
    message_id = message.get("message_id")
    chat_id = message.get("chat", {}).get("id")

    # 1. Telegram'ga tugma bosilgani haqida javob berish (soat millari aylanib qolmasligi uchun)
    requests.post(
        f"https://api.telegram.org/bot{BOT_TOKEN}/answerCallbackQuery",
        json={"callback_query_id": callback_id},
    )

    # 2. Qaysi tugma bosilganiga qarab xabarni yangilash
    if callback_data.startswith("accept:"):
      new_text = message.get("text", "") + "\n\n✅ <b>BUYURTMA QABUL QILINDI</b>"
      requests.post(
          f"https://api.telegram.org/bot{BOT_TOKEN}/editMessageText",
          json={
              "chat_id": chat_id,
              "message_id": message_id,
              "text": new_text,
              "parse_mode": "HTML",
          },
      )
    elif callback_data.startswith("cancel:"):
      new_text = message.get("text", "") + "\n\n❌ <b>BUYURTMA BEKOR QILINDI</b>"
      requests.post(
          f"https://api.telegram.org/bot{BOT_TOKEN}/editMessageText",
          json={
              "chat_id": chat_id,
              "message_id": message_id,
              "text": new_text,
              "parse_mode": "HTML",
          },
      )

  return {"status": "ok"}
