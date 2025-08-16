import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch"; // Node 18 alatt kell, 18+ esetén beépített

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const HF_API_KEY = process.env.HF_API_KEY;
if (!HF_API_KEY) {
  console.error("❌ Nincs beállítva HF_API_KEY a .env fájlban!");
  process.exit(1);
}

// Használt modell URL-je (bármely Hugging Face modell lehet, pl. Zephyr)
const HF_API_URL =
  "https://api-inference.huggingface.co/models/HuggingFaceH4/zephyr-7b-beta";

// Egyszerű emlékezet
let conversation = [];

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message missing" });

    // Felhasználói üzenet hozzáadása
    conversation.push({ role: "user", content: message });
    if (conversation.length > 15) conversation = conversation.slice(-15);

    // A Hugging Face nem ismeri a role-t -> kontextust egy szövegbe fűzzük
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
        },
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("HF API hiba:", data.error);
      return res.status(500).json({ error: data.error });
    }

    const botMessage =
      data[0]?.generated_text?.replace(prompt, "").trim() || "Nincs válasz";

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
