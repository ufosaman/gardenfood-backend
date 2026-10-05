import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import requests

app = FastAPI()

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
CHAT_ID = "8757414683"

def send_telegram_request(method: str, payload: dict):
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
    return requests.post(url, json=payload).json()

@app.get("/")
def home():
    return {"status": "Garden Food Backend ishlayapti!"}

@app.post("/api/order")
async def send_order(data: OrderData):
    payload = {
        "chat_id": CHAT_ID,
        "text": data.text + "\n\n📌 <b>Holati:</b> Yangi buyurtma",
        "parse_mode": "HTML",
        "reply_markup": {
            "inline_keyboard": [
                [
                    {"text": "✅ Qabul qilish", "callback_data": f"accept:{data.orderId}"},
                    {"text": "❌ Bekor qilish", "callback_data": f"cancel_menu:{data.orderId}"}
                ]
            ]
        }
    }
    res = send_telegram_request("sendMessage", payload)
    return {"status": "ok", "telegram_response": res}

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
        current_text = message.get("text", "")

        # Telegram'dagi yuklanish ikonkasini to'xtatish
        send_telegram_request("answerCallbackQuery", {"callback_query_id": callback_id})

        # 1. BOSQICH: QABUL QILISH -> TAYYORLANMOQDA
        if callback_data.startswith("accept:"):
            order_id = callback_data.split(":")[1]
            base_text = current_text.split("\n\n📌")[0]
            new_text = f"{base_text}\n\n📌 <b>Holati:</b> ✅ Qabul qilindi"
            
            payload = {
                "chat_id": chat_id,
                "message_id": message_id,
                "text": new_text,
                "parse_mode": "HTML",
                "reply_markup": {
                    "inline_keyboard": [
                        [{"text": "👨‍🍳 Tayyorlanmoqda", "callback_data": f"cooking:{order_id}"}],
                        [{"text": "❌ Bekor qilish", "callback_data": f"cancel_menu:{order_id}"}]
                    ]
                }
            }
            send_telegram_request("editMessageText", payload)

        # 2. BOSQICH: TAYYORLANMOQDA -> YO'LGA CHIQDI
        elif callback_data.startswith("cooking:"):
            order_id = callback_data.split(":")[1]
            base_text = current_text.split("\n\n📌")[0]
            new_text = f"{base_text}\n\n📌 <b>Holati:</b> 👨‍🍳 Tayyorlanmoqda"
            
            payload = {
                "chat_id": chat_id,
                "message_id": message_id,
                "text": new_text,
                "parse_mode": "HTML",
                "reply_markup": {
                    "inline_keyboard": [
                        [{"text": "🚚 Yo'lga chiqdi (Kuryerda)", "callback_data": f"on_way:{order_id}"}]
                    ]
                }
            }
            send_telegram_request("editMessageText", payload)

        # 3. BOSQICH: YO'LGA CHIQDI -> YETKAZILDI (YAKUN)
        elif callback_data.startswith("on_way:"):
            base_text = current_text.split("\n\n📌")[0]
            new_text = f"{base_text}\n\n📌 <b>Holati:</b> 🎉 Yetkazib berildi"
            
            payload = {
                "chat_id": chat_id,
                "message_id": message_id,
                "text": new_text,
                "parse_mode": "HTML",
                "reply_markup": {"inline_keyboard": []} # Tugmalarni olib tashlaymiz
            }
            send_telegram_request("editMessageText", payload)

        # 4. BEKOR QILISH MENYUSI (Izoh tanlash)
        elif callback_data.startswith("cancel_menu:"):
            order_id = callback_data.split(":")[1]
            payload = {
                "chat_id": chat_id,
                "message_id": message_id,
                "text": current_text + "\n\n❓ <b>Bekor qilish sababini tanlang:</b>",
                "parse_mode": "HTML",
                "reply_markup": {
                    "inline_keyboard": [
                        [{"text": "🚫 Masalliq tugagan", "callback_data": f"cancel_reason:{order_id}:Masalliq tugagan"}],
                        [{"text": "📞 Mijoz telefonni olmadi", "callback_data": f"cancel_reason:{order_id}:Mijoz aloqaga chiqmadi"}],
                        [{"text": "❌ Mijoz rad etdi", "callback_data": f"cancel_reason:{order_id}:Mijoz rad etdi"}],
                        [{"text": "⬅️ Orqaga", "callback_data": f"accept:{order_id}"}]
                    ]
                }
            }
            send_telegram_request("editMessageText", payload)

        # 5. BEKOR QILISH SABABI BILAN YAKUNLASH
        elif callback_data.startswith("cancel_reason:"):
            _, order_id, reason = callback_data.split(":", 2)
            base_text = current_text.split("\n\n📌")[0]
            new_text = f"{base_text}\n\n📌 <b>Holati:</b> ❌ Bekor qilindi\n💬 <b>Izoh:</b> {reason}"
            
            payload = {
                "chat_id": chat_id,
                "message_id": message_id,
                "text": new_text,
                "parse_mode": "HTML",
                "reply_markup": {"inline_keyboard": []}
            }
            send_telegram_request("editMessageText", payload)

    return {"status": "ok"}
