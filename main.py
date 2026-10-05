import os
import random
from typing import Optional
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

BOT_TOKEN = os.getenv("BOT_TOKEN")
CHAT_ID = "8757414683"

# Firebase Realtime Database URL (O'zingizning Firebase URL manzilingiz bilan almashtirishingiz mumkin)
FIREBASE_URL = os.getenv(
    "FIREBASE_URL", "https://gardenfood-default-rtdb.firebaseio.com"
)

# --- VAQTINCHALIK XOTIRA (OTP uchun) ---
otp_store = {}


# --- MODEL SHABLONLARI ---
class OrderData(BaseModel):
  orderId: str
  text: str
  phone: Optional[str] = "Noma'lum"


class OTPRequest(BaseModel):
  phone: str


class OTPVerify(BaseModel):
  phone: str
  code: str


def send_telegram_request(method: str, payload: dict):
  url = f"https://api.telegram.org/bot{BOT_TOKEN}/{method}"
  return requests.post(url, json=payload).json()


# --- FIREBASE YORDAMCHI FUNKSIYALARI ---
def firebase_set(path: str, data: dict):
  """Firebase'ga ma'lumot yozish yoki yangilash"""
  try:
    url = f"{FIREBASE_URL}/{path}.json"
    requests.patch(url, json=data)
  except Exception as e:
    print(f"Firebase error: {e}")


def firebase_get(path: str):
  """Firebase'dan ma'lumot o'qish"""
  try:
    url = f"{FIREBASE_URL}/{path}.json"
    res = requests.get(url)
    return res.json() or {}
  except Exception as e:
    print(f"Firebase error: {e}")
    return {}


@app.get("/")
def home():
  return {"status": "Garden Food Backend (Firebase Enabled) ishlayapti!"}


# --- AUTENTIFIKATSIYA ENDPOINTLARI (OTP) ---


@app.post("/api/auth/send-otp")
async def send_otp(data: OTPRequest):
  code = str(random.randint(100000, 999999))
  otp_store[data.phone] = code

  text = (
      f"🔐 <b>Garden Food - Tasdiqlash kodi</b>\n\n"
      f"📱 Telefon: <code>{data.phone}</code>\n"
      f"🔑 Tasdiqlash kodi: <code>{code}</code>"
  )

  send_telegram_request(
      "sendMessage",
      {"chat_id": CHAT_ID, "text": text, "parse_mode": "HTML"},
  )

  return {
      "status": "ok",
      "message": "Tasdiqlash kodi yuborildi",
      "demo_code": code,
  }


@app.post("/api/auth/verify-otp")
async def verify_otp(data: OTPVerify):
  saved_code = otp_store.get(data.phone)
  if saved_code and saved_code == data.code:
    del otp_store[data.phone]
    return {
        "status": "ok",
        "authenticated": True,
        "phone": data.phone,
        "token": f"token_{data.phone}",
    }
  return {"status": "error", "message": "Tasdiqlash kodi noto'g'ri!"}


# --- BUYURTMA BERISH VA TARIX ---


@app.post("/api/order")
async def send_order(data: OrderData):
  order_info = {
      "orderId": data.orderId,
      "phone": data.phone,
      "status": "Yangi buyurtma",
      "text": data.text,
  }

  # Firebase Realtime Database'ga saqlash
  firebase_set(f"orders/{data.orderId}", order_info)

  payload = {
      "chat_id": CHAT_ID,
      "text": (
          f"{data.text}\n\n📱 <b>Tel:</b> {data.phone}\n📌 <b>Holati:</b>"
          " Yangi buyurtma"
      ),
      "parse_mode": "HTML",
      "reply_markup": {
          "inline_keyboard": [[
              {
                  "text": "✅ Qabul qilish",
                  "callback_data": f"accept:{data.orderId}",
              },
              {
                  "text": "❌ Bekor qilish",
                  "callback_data": f"cancel_menu:{data.orderId}",
              },
          ]]
      },
  }
  res = send_telegram_request("sendMessage", payload)
  return {"status": "ok", "telegram_response": res}


@app.get("/api/orders/{phone}")
async def get_user_orders(phone: str):
  # Firebase'dan barcha buyurtmalarni olish
  all_orders = firebase_get("orders")

  user_orders = []
  if isinstance(all_orders, dict):
    user_orders = [
        order
        for order in all_orders.values()
        if isinstance(order, dict) and order.get("phone") == phone
    ]

  active_orders = [
      o
      for o in user_orders
      if o.get("status") not in ["🎉 Yetkazib berildi", "❌ Bekor qilindi"]
  ]
  history_orders = [
      o
      for o in user_orders
      if o.get("status") in ["🎉 Yetkazib berildi", "❌ Bekor qilindi"]
  ]

  return {
      "status": "ok",
      "active": active_orders,
      "history": history_orders,
  }


# --- TELEGRAM WEBHOOK (STATUSLARNI REAL-TIME YANGILASH) ---


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

    send_telegram_request(
        "answerCallbackQuery", {"callback_query_id": callback_id}
    )

    # 1. QABUL QILISH -> TAYYORLANMOQDA
    if callback_data.startswith("accept:"):
      order_id = callback_data.split(":")[1]
      firebase_set(f"orders/{order_id}", {"status": "✅ Qabul qilindi"})

      base_text = current_text.split("\n\n📌")[0]
      new_text = f"{base_text}\n\n📌 <b>Holati:</b> ✅ Qabul qilindi"

      payload = {
          "chat_id": chat_id,
          "message_id": message_id,
          "text": new_text,
          "parse_mode": "HTML",
          "reply_markup": {
              "inline_keyboard": [
                  [{
                      "text": "👨‍🍳 Tayyorlanmoqda",
                      "callback_data": f"cooking:{order_id}",
                  }],
                  [{
                      "text": "❌ Bekor qilish",
                      "callback_data": f"cancel_menu:{order_id}",
                  }],
              ]
          },
      }
      send_telegram_request("editMessageText", payload)

    # 2. TAYYORLANMOQDA -> YO'LGA CHIQDI
    elif callback_data.startswith("cooking:"):
      order_id = callback_data.split(":")[1]
      firebase_set(f"orders/{order_id}", {"status": "👨‍🍳 Tayyorlanmoqda"})

      base_text = current_text.split("\n\n📌")[0]
      new_text = f"{base_text}\n\n📌 <b>Holati:</b> 👨‍🍳 Tayyorlanmoqda"

      payload = {
          "chat_id": chat_id,
          "message_id": message_id,
          "text": new_text,
          "parse_mode": "HTML",
          "reply_markup": {
              "inline_keyboard": [[{
                  "text": "🚚 Yo'lga chiqdi (Kuryerda)",
                  "callback_data": f"on_way:{order_id}",
              }]]
          },
      }
      send_telegram_request("editMessageText", payload)

    # 3. YO'LGA CHIQDI -> YETKAZILDI
    elif callback_data.startswith("on_way:"):
      order_id = callback_data.split(":")[1]
      firebase_set(f"orders/{order_id}", {"status": "🎉 Yetkazib berildi"})

      base_text = current_text.split("\n\n📌")[0]
      new_text = f"{base_text}\n\n📌 <b>Holati:</b> 🎉 Yetkazib berildi"

      payload = {
          "chat_id": chat_id,
          "message_id": message_id,
          "text": new_text,
          "parse_mode": "HTML",
          "reply_markup": {"inline_keyboard": []},
      }
      send_telegram_request("editMessageText", payload)

    # 4. BEKOR QILISH MENYUSI
    elif callback_data.startswith("cancel_menu:"):
      order_id = callback_data.split(":")[1]
      payload = {
          "chat_id": chat_id,
          "message_id": message_id,
          "text": (
              current_text + "\n\n❓ <b>Bekor qilish sababini tanlang:</b>"
          ),
          "parse_mode": "HTML",
          "reply_markup": {
              "inline_keyboard": [
                  [{
                      "text": "🚫 Masalliq tugagan",
                      "callback_data": (
                          f"cancel_reason:{order_id}:Masalliq tugagan"
                      ),
                  }],
                  [{
                      "text": "📞 Mijoz telefonni olmadi",
                      "callback_data": (
                          f"cancel_reason:{order_id}:Mijoz aloqaga chiqmadi"
                      ),
                  }],
                  [{
                      "text": "❌ Mijoz rad etdi",
                      "callback_data": f"cancel_reason:{order_id}:Mijoz rad etdi",
                  }],
                  [{
                      "text": "⬅️ Orqaga",
                      "callback_data": f"accept:{order_id}",
                  }],
              ]
          },
      }
      send_telegram_request("editMessageText", payload)

    # 5. BEKOR QILISH SABABI BILAN YAKUNLASH
    elif callback_data.startswith("cancel_reason:"):
      _, order_id, reason = callback_data.split(":", 2)
      firebase_set(
          f"orders/{order_id}",
          {"status": "❌ Bekor qilindi", "cancel_reason": reason},
      )

      base_text = current_text.split("\n\n📌")[0]
      new_text = (
          f"{base_text}\n\n📌 <b>Holati:</b> ❌ Bekor qilindi\n💬 <b>Izoh:</b>"
          f" {reason}"
      )

      payload = {
          "chat_id": chat_id,
          "message_id": message_id,
          "text": new_text,
          "parse_mode": "HTML",
          "reply_markup": {"inline_keyboard": []},
      }
      send_telegram_request("editMessageText", payload)

  return {"status": "ok"}
