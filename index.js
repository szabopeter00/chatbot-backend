import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import cors from "cors";
app.use(cors());

dotenv.config();

const app = express();
app.use(express.json());

const API_KEY = process.env.MISTRAL_API_KEY;
if (!API_KEY) {
  console.error("❌ Nincs beállítva MISTRAL_API_KEY a .env fájlban!");
  process.exit(1);
}

// Emlékezet (minden felhasználóra külön ID kellene a valódi verzióban)
let conversation = [];

app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body;

    // Hozzáadjuk az új üzenetet a beszélgetéshez
    conversation.push({ role: "user", content: message });

    // Csak az utolsó 15 üzenetet tartjuk meg
    if (conversation.length > 15) {
      conversation = conversation.slice(-15);
    }

    const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-7b-instruct",
        messages: conversation,
      }),
    });

    const data = await response.json();
    const botMessage = data.choices[0].message.content;

    // Bot válaszát is mentjük a memóriába
    conversation.push({ role: "assistant", content: botMessage });

    res.json({ reply: botMessage });
  } catch (error) {
    console.error("Hiba a Mistral API hívás közben:", error);
    res.status(500).json({ error: "Hiba történt a Mistral API hívásakor" });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(
    `✅ Chatbot backend fut: http://localhost:${process.env.PORT || 3000}`
  );
});
