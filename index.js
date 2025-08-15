import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import cors from "cors";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.MISTRAL_API_KEY;
if (!API_KEY) {
  console.error("❌ Nincs beállítva MISTRAL_API_KEY a .env fájlban!");
  process.exit(1);
}

// Egyszerű emlékezet
let conversation = [];

// Dinamikus modell ellenőrzés
async function getFirstAvailableModel() {
  const res = await fetch("https://api.mistral.ai/v1/models", {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  const data = await res.json();
  return data.data?.[0]?.id; // visszaadja az első elérhető modellt
}

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message missing" });

    conversation.push({ role: "user", content: message });
    if (conversation.length > 15) conversation = conversation.slice(-15);

    const model = await getFirstAvailableModel();
    if (!model) return res.status(500).json({ error: "Nincs elérhető modell" });

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: conversation,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      console.error("Mistral API hiba:", text);
      return res.status(500).json({ error: "Hiba a Mistral API hívásakor" });
    }

    const data = await response.json();
    const botMessage = data.result?.[0]?.content?.[0]?.text;
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
