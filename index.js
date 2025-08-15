import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.OPENAI_API_KEY;
if (!API_KEY) {
  console.error("❌ Nincs beállítva OPENAI_API_KEY a .env fájlban!");
  process.exit(1);
}

// Egyszerű emlékezet
let conversation = [];

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message missing" });

    conversation.push({ role: "user", content: message });
    if (conversation.length > 15) conversation = conversation.slice(-15);

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo", // ingyenesen használható modell
        messages: conversation,
      }),
    });

    const data = await response.json();
    const botMessage = data.choices?.[0]?.message?.content;

    if (!botMessage)
      return res.status(500).json({ error: "Érvénytelen API válasz" });

    conversation.push({ role: "assistant", content: botMessage });
    res.json({ reply: botMessage });
  } catch (error) {
    console.error("Hiba a chat endpointban:", error);
    res.status(500).json({ error: "Hiba történt a szerver oldalon" });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(
    `✅ Chatbot backend fut: http://localhost:${process.env.PORT || 3000}`
  );
});
