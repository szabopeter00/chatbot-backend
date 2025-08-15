import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { config as loadEnv } from "dotenv";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";

loadEnv();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

const HF_TOKEN = process.env.HF_TOKEN;
const PORT = process.env.PORT || 3000;

// Adaptív kontextus-limitek
const MAX_TURNS = Number(process.env.MAX_TURNS || 20); // üzenetpárok száma (user+assistant)
const MAX_CHARS = Number(process.env.MAX_CHARS || 12000); // teljes prompt kb. karakterlimit

// 1) Betöltjük a személyes profil adatokat
const me = JSON.parse(fs.readFileSync("./me.json", "utf8"));

// 2) Szerver oldali beszélgetés-tár (memória) sessionönként
//    Kulcs: sessionId (amit a kliens küld), Érték: messages tömb
const conversations = new Map();

/**
 * Mistral Instruct chat formázó (simple template)
 * Többkörös beszélgetést egyetlen "inputs" sztringbe fűz:
 * - Az első üzenetben a system kontextust <<SYS>> ... <</SYS>> blokkban adjuk.
 * - Utána felváltva user/assistant körök.
 */
function buildMistralPrompt(messages, systemText = "") {
  // Első kör: system + első user
  const chunks = [];
  let firstUserFound = false;

  // Ha van systemText, a legelső [INST]-be ágyazzuk:
  // [INST] <<SYS>> ... <</SYS>> USER1 [/INST] ASSISTANT1
  // Köv. körök: <s>[INST] USERn [/INST] ASSISTANTn
  let pendingAssistant = null;

  const systemBlock = systemText ? `<<SYS>>\n${systemText}\n<</SYS>>\n\n` : "";

  for (const m of messages) {
    if (m.role === "system") {
      // Már külön systemText-tel dolgozunk; ezt itt kihagyjuk
      continue;
    }
    if (!firstUserFound && m.role === "user") {
      firstUserFound = true;
      chunks.push(`<s>[INST] ${systemBlock}${m.content} [/INST]`);
      pendingAssistant = true;
      continue;
    }
    if (m.role === "assistant" && pendingAssistant) {
      chunks[chunks.length - 1] += ` ${m.content}</s>`;
      pendingAssistant = false;
      continue;
    }
    if (m.role === "user") {
      chunks.push(`<s>[INST] ${m.content} [/INST]`);
      pendingAssistant = true;
      continue;
    }
    if (m.role === "assistant" && pendingAssistant) {
      chunks[chunks.length - 1] += ` ${m.content}</s>`;
      pendingAssistant = false;
      continue;
    }
  }

  // Ha a legutolsó kör user-rel zárult (nincs assistant),
  // akkor az utolsó [INST] után a modell fog generálni.
  return chunks.join("\n");
}

/**
 * Dinamikus kontextus-trimmelés:
 * - Megtartjuk a legelső system üzenetet (persona + me.json)
 * - Limitáljuk a körök számát (MAX_TURNS)
 * - Limitáljuk a karaktereket (MAX_CHARS) – becslés a tokenekre
 */
function trimContext(messages) {
  if (!messages.length) return messages;

  const system = messages.find((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");

  // 1) Körök limitje (user+assistant párok)
  // pároképzés: végigmegyünk a "rest"-en és csak az utolsó MAX_TURNS*2 elemet tartjuk meg
  const paired = [];
  for (const m of rest) paired.push(m);
  const maxItems = MAX_TURNS * 2; // kb. ennyi elem egyenlő számú user/assistant esetén
  let trimmed = paired.slice(-maxItems);

  // 2) Karakterlimit (durva becslés)
  const rebuild = (list) =>
    [system, ...list]
      .filter(Boolean)
      .map((m) => m.content)
      .join("\n");
  while (rebuild(trimmed).length > MAX_CHARS && trimmed.length > 2) {
    // levágunk a legrégebbi elejéről 2-t (user+assistant)
    trimmed = trimmed.slice(2);
  }

  return [system, ...trimmed].filter(Boolean);
}

/**
 * Létrehozza (vagy lekéri) a session-ös beszélgetést.
 * Az első hívásnál betesz egy system üzenetet a me.json alapján.
 */
function getOrCreateConversation(sessionId) {
  if (!conversations.has(sessionId)) {
    const systemPersona = `Te ${me.nev} vagy. Kommunikációs stílus: ${
      me.szemelyiseg
    }.
Nyelv: ${me.nyelv || "hu"}.

Rólad szóló tények (használhatod válaszadáskor, ne találj ki új tényeket):
${JSON.stringify(me, null, 2)}

Válaszadás:
- Légy lényegre törő, természetes, emberi hangvételben.
- Ha visszakérdeznek ugyanarra a témára (pl. fizetési igény), tartsd a korábbi konzisztenciát a fenti adatokkal.
- Ha számszerűsítést kérnek (pl. “konkrét összeg”), használd a megfelelő, konkrét mezőt (pl. me.fizetesi_igeny.konkret).
- Ha valamit nem tudsz biztosan a fenti adatokból, kérdezz vissza vagy mondd, hogy nem áll rendelkezésre információ.`;

    conversations.set(sessionId, [{ role: "system", content: systemPersona }]);
  }
  return conversations.get(sessionId);
}

/**
 * HF Inference API hívás (Mistral-7B-Instruct)
 */
async function callMistral(prompt) {
  const url =
    "https://api-inference.huggingface.co/models/mistralai/Mistral-7B-Instruct-v0.2";

  const payload = {
    inputs: prompt,
    parameters: {
      max_new_tokens: 300,
      temperature: 0.7,
      top_p: 0.95,
      repetition_penalty: 1.05,
      return_full_text: false,
    },
  };

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${HF_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`HF API error: ${resp.status} ${resp.statusText} – ${t}`);
  }

  const data = await resp.json();
  // Válasz szerkezete: [{ generated_text: "..." }, ...]
  if (Array.isArray(data) && data[0]?.generated_text) {
    return data[0].generated_text.trim();
  }
  // Biztonsági fallback
  const asText =
    (typeof data === "string" && data) ||
    (data?.generated_text ?? JSON.stringify(data));
  return String(asText).trim();
}

/**
 * Egyszerű health-check
 */
app.get("/health", (_req, res) => {
  res.json({ ok: true, model: "Mistral-7B-Instruct-v0.2" });
});

/**
 * (Opcionális) Session ID generálás
 */
app.get("/session", (_req, res) => {
  res.json({ sessionId: uuidv4() });
});

/**
 * Fő chat endpoint
 * Body: { sessionId: string, message: string }
 */
app.post("/chat", async (req, res) => {
  try {
    if (!HF_TOKEN) {
      return res
        .status(500)
        .json({ error: "HF_TOKEN hiányzik a szerveren (.env)!" });
    }

    const { sessionId, message } = req.body || {};
    if (!sessionId || !message) {
      return res
        .status(400)
        .json({ error: "sessionId és message kötelező mezők." });
    }

    const convo = getOrCreateConversation(sessionId);

    // Hozzáadjuk a user üzenetet
    convo.push({ role: "user", content: String(message) });

    // Trim kontextus (adaptív)
    const trimmed = trimContext(convo);

    // Mistral prompt építése (system külön blokkal)
    const systemMsg = trimmed.find((m) => m.role === "system");
    const nonSystem = trimmed.filter((m) => m.role !== "system");
    const prompt = buildMistralPrompt(nonSystem, systemMsg?.content || "");

    // Hívjuk a modellt
    const reply = await callMistral(prompt);

    // Hozzáadjuk az assistant választ a teljes beszélgetéshez
    convo.push({ role: "assistant", content: reply });

    // Frissített, trimmelt konverzációt visszaírjuk a memóriába
    conversations.set(sessionId, trimContext(convo));

    res.json({ reply });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ error: "Szerver hiba vagy modell hiba.", detail: String(err) });
  }
});

app.listen(PORT, () => console.log(`Chatbot backend fut a ${PORT} porton…`));
