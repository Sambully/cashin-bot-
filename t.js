import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import speakeasy from "speakeasy";
import TelegramBot from "node-telegram-bot-api";
import fs from "fs";

// ================== CONFIG ==================
const BOT_TOKEN = "7961037186:AAGUH8ts_WzvX9zwIOhimhqqIiq8urTKO4k"; // Telegram Bot Token
const SECRET_KEY = "WMWMHAI5WPEHOKSAM3FELH4B5BOD4KSN"; // iCash MFA Secret
const USERNAME = "icashvouchercashin@gmail.com";
const PASSWORD = "Automation@880880";
const USERS_FILE = "users.json"; // Registered users store
const PORT = 5003; // API Port

// ================== INIT BOT ==================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ================== INIT SERVER ==================
const app = express();
app.use(bodyParser.json());

// ✅ Load users
const loadUsers = () => {
  if (!fs.existsSync(USERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(USERS_FILE, "utf8"));
};

// ✅ Save users
const saveUsers = (users) => {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

// ✅ Register User Command
bot.onText(/\/register/, (msg) => {
  const chatId = msg.chat.id;
  let users = loadUsers();

  if (!users.includes(chatId)) {
    users.push(chatId);
    saveUsers(users);
    bot.sendMessage(chatId, "✅ You are now registered for alerts!");
  } else {
    bot.sendMessage(chatId, "ℹ️ You are already registered.");
  }
});

// ✅ Unregister Command
bot.onText(/\/unregister/, (msg) => {
  const chatId = msg.chat.id;
  let users = loadUsers();

  if (users.includes(chatId)) {
    users = users.filter((id) => id !== chatId);
    saveUsers(users);
    bot.sendMessage(chatId, "❌ You have been unregistered.");
  } else {
    bot.sendMessage(chatId, "ℹ️ You are not registered.");
  }
});

// ✅ MFA Code Generator
const generateMFACode = () => {
  return speakeasy.totp({
    secret: SECRET_KEY,
    encoding: "base32",
  });
};

// ✅ Default headers
const getHeaders = () => ({
  "Content-Type": "application/json",
  Platform: "WEB_ANDROID",
  Origin: "https://panel.icash.one",
  Referer: "https://panel.icash.one/",
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
});

// ✅ Login + Get Session
const getSessionToken = async () => {
  try {
    const loginResponse = await axios.post(
      "https://rb.icash.one/v1/resellers/login",
      {
        user_name: USERNAME,
        password: PASSWORD,
      },
      { headers: getHeaders() }
    );

    const { reseller_id, hash_jwt } = loginResponse.data;
    const mfaCode = generateMFACode();

    const mfaResponse = await axios.post(
      "https://rb.icash.one/v1/resellers/login/mfa",
      {
        mfa_code: mfaCode,
        reseller_id: reseller_id,
        hash_jwt: hash_jwt,
      },
      { headers: getHeaders() }
    );

    const cookies = mfaResponse.headers["set-cookie"];
    const sessionToken = cookies
      .find((cookie) => cookie.startsWith("SESSION_TOKEN="))
      .split(";")[0];

    return sessionToken;
  } catch (err) {
    console.error("❌ Login Failed:", err.message);
    return null;
  }
};

// ✅ Check Balance
const checkBalance = async () => {
  try {
    const sessionToken = await getSessionToken();
    if (!sessionToken) return;

    const authHeaders = {
      ...getHeaders(),
      Cookie: sessionToken,
    };

    const res = await axios.get("https://rb.icash.one/v1/resellers", {
      headers: authHeaders,
    });

    const balance = res.data.balance_list[0].balance;
    console.log("💰 Current Balance:", balance);

    if (balance < 100000) {
      const users = loadUsers();
      for (let chatId of users) {
        await bot.sendMessage(
          chatId,
          `⚠️ Balance Low Alert!\n\nCurrent Balance: ₹${balance}\nPlease recharge your wallet.`
        );
      }
    }
  } catch (err) {
    console.error("❌ Balance Check Error:", err.message);
  }
};

// ✅ Run every 5 minutes (optional)
setInterval(checkBalance, 5 * 1000);

// ✅ Manual Balance Command
bot.onText(/\/balance/, async (msg) => {
  const chatId = msg.chat.id;
  const sessionToken = await getSessionToken();
  if (!sessionToken) return bot.sendMessage(chatId, "❌ Login failed");

  const authHeaders = {
    ...getHeaders(),
    Cookie: sessionToken,
  };

  const res = await axios.get("https://rb.icash.one/v1/resellers", {
    headers: authHeaders,
  });

  const balance = res.data.balance_list[0].balance;
  bot.sendMessage(chatId, `💰 Current Balance: ₹${balance}`);
});

// ✅ Order Webhook API
app.post("/order-webhook", async (req, res) => {
  try {
    const data = req.body;

    if (!data.order_id) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    // Prepare message
    const message = `
🧾 *New Order Received!*

📌 Order ID: ${data.order_id}
👤 Name: ${data.user_name}
📧 Email: ${data.email}
📱 Phone: ${data.phone}
💰 Amount: ₹${data.amount}
🎟 Quantity: ${data.quantity}
🎁 Voucher: ${data.voucher_name}
🏦 Bank: ${data.bank_details}
✅ Status: ${data.payment_status}
⏰ Time: ${data.timestamp}
🔗 Source: ${data.source}
    `;

    // Broadcast to all registered users
    const users = loadUsers();
    for (let chatId of users) {
      await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
    }

    return res.json({ success: true, broadcasted_to: users.length });
  } catch (err) {
    console.error("❌ Webhook Error:", err.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// ✅ Start Express Server
app.listen(PORT, () => {
  console.log(`🚀 API Server running on http://localhost:${PORT}`);
});

console.log("🚀 Telegram Bot Started...");