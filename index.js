import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const HF_API_KEY = process.env.HF_API_KEY;
if (!HF_API_KEY) {
  console.error("❌ Nincs beállítva HF_API_KEY a .env fájlban!");
  process.exit(1);
}

// Használt modell URL-je
const HF_API_URL = "https://api-inference.huggingface.co/models/gpt2";

// Egyszerű emlékezet
let conversation = [];

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message missing" });

    // Felhasználói üzenet hozzáadása
    conversation.push({ role: "user", content: message });
    if (conversation.length > 15) conversation = conversation.slice(-15);

    // Kontextus összeállítása promptba
    const prompt =
      conversation
        .map((msg) =>
          msg.role === "user"
            ? `User: ${msg.content}`
            : `Assistant: ${msg.content}`
        )
        .join("\n") + "\nAssistant:";

    // API hívás
    const response = await fetch(HF_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${HF_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          max_new_tokens: 200,
          temperature: 0.7,
          return_full_text: false,
        },
      }),
    });

    // Válasz szövegként
    const text = await response.text();

    // Próbáljuk JSON-ként értelmezni
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      console.error("Nem JSON választ kaptunk a HF API-tól:", text);
      return res.status(500).json({ error: text });
    }

    // Ellenőrzés, hogy van-e hiba a HF API válaszában
    if (data.error) {
      console.error("HF API hiba:", data.error);
      return res.status(500).json({ error: data.error });
    }

    // Bot üzenet kinyerése
    let botMessage = "";
    if (Array.isArray(data) && data[0]?.generated_text) {
      botMessage = data[0].generated_text.trim();
    } else if (typeof data.generated_text === "string") {
      botMessage = data.generated_text.trim();
    } else {
      botMessage = "Nincs válasz";
    }

    // Bot üzenet mentése
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
