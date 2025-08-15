import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  console.error("❌ Nincs beállítva OPENAI_API_KEY a .env fájlban!");
  process.exit(1);
}

// OpenAI kliens létrehozása
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Egyszerű emlékezet
let conversation = [];

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message missing" });

    conversation.push({ role: "user", content: message });
    if (conversation.length > 15) conversation = conversation.slice(-15);

    // OpenAI Chat Completion
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // használhatsz "gpt-4"-et is
      messages: conversation.map((msg) => ({
        role: msg.role,
        content: msg.content,
      })),
    });

    const botMessage = response.choices?.[0]?.message?.content;
    if (!botMessage)
      return res.status(500).json({ error: "Érvénytelen API válasz" });

    conversation.push({ role: "assistant", content: botMessage });

    res.json({ reply: botMessage });
  } catch (error) {
    console.error("Hiba a chat endpointban:", error);
    res
      .status(500)
      .json({ error: error.message || "Hiba történt a szerver oldalon" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Chatbot backend fut: http://localhost:${PORT}`);
});
