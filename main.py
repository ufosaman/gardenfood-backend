from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import requests

app = FastAPI()

# 1. CORS sozlamasi (Frontend'dan kelayotgan blokirovkalarni yechadi)
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

@app.get("/")
def home():
    return {"status": "Garden Food Backend ishlayapti!"}

@app.post("/api/order")
async def send_order(data: OrderData):
    bot_token = os.getenv("BOT_TOKEN")
    chat_id = "8757414683"
    
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": data.text,
        "parse_mode": "HTML",
        "reply_markup": {
            "inline_keyboard": [
                [
                    {"text": "✅ Qabul qilish", "callback_data": f"{data.orderId}:accept"},
                    {"text": "❌ Bekor qilish", "callback_data": f"{data.orderId}:cancel"}
                ]
            ]
        }
    }
    
    res = requests.post(url, json=payload)
    return {"status": "ok", "telegram_response": res.json()}