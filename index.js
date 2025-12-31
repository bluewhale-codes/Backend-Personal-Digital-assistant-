const express = require("express");
const Groq = require("groq-sdk");
const cors = require("cors");
require("dotenv").config();

const loadOwnerData = require("./rag/loader");
const chunkDocuments = require("./rag/embed");
const vectorStore = require("./rag/vectorStore");

const app = express();
app.use(express.json());
// Middlewares
app.use(
  cors({
    origin: "http://localhost:5173", // frontend URL
    credentials: true                // allow cookies
  })
);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

/* ---------------- SYSTEM PROMPT ---------------- */

const SYSTEM_PROMPT = `
You are a private personal AI assistant.

STRICT RULES:
- Answer ONLY from the provided CONTEXT.
- Do NOT use external or general knowledge.
- If the answer is not present in the context, reply exactly:
  "I don’t have information about that."
- Do NOT guess or explain concepts.
- Keep answers concise and factual.
`;

/* ---------------- HARD GUARD ---------------- */

function isGeneralKnowledge(prompt) {
  const lower = prompt.toLowerCase().trim();

  const blocked = [
    /^what is /,
    /^who is /,
    /^explain /,
    /^define /,
    /^describe /,
    /^how does /,
    /^tell me about /,
    /^what are /
  ];

  const personalSignals = ["my", "your", "me", "i ", "mine", "myself"];
  const isPersonal = personalSignals.some(w => lower.includes(w));

  if (isPersonal) return false;
  return blocked.some(rx => rx.test(lower));
}

/* ---------------- RAG INIT ---------------- */

let ragReady = false;

async function initRAG() {
  try {
    console.log("🔹 Initializing RAG pipeline...");

    // ✅ IMPORTANT: init embedder FIRST
    await vectorStore.initEmbedder();

    const loaded = vectorStore.loadFromDisk();

    if (!loaded || vectorStore.vectors.length === 0) {
      console.log("🔁 Rebuilding vector store...");

      const docs = loadOwnerData();
      console.log("📄 Loaded documents:", docs.length);

      const chunks = await chunkDocuments(docs);
      console.log("🧩 Created chunks:", chunks.length);

      await vectorStore.buildVectorStore(chunks);
    }

    // ✅ THIS WAS MISSING
    ragReady = true;
    console.log("✅ RAG is READY");

  } catch (err) {
    console.error("❌ Failed to initialize RAG:", err);
    process.exit(1);
  }
}

// 🚀 Start RAG init
initRAG();

/* ---------------- ASK ENDPOINT ---------------- */

app.post("/ask", async (req, res) => {
  try {
    if (!ragReady) {
      return res.json({
        answer: "System is initializing. Please try again."
      });
    }

    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required" });
    }

    // 🔒 HARD GUARD
    if (isGeneralKnowledge(prompt)) {
      return res.json({
        answer: "I can only answer questions related to my personal data."
      });
    }

    // 🔍 RAG SEARCH
    const docs = await vectorStore.search(prompt);

    if (!docs || docs.length === 0) {
      return res.json({
        answer: "I don’t have information about that."
      });
    }

    const context = docs.map(d => d.content).join("\n");

    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `CONTEXT:\n${context}\n\nQUESTION:\n${prompt}`
        }
      ]
    });

    res.json({
      answer: completion.choices[0].message.content
    });

  } catch (err) {
    console.error("❌ /ask error:", err);
    res.status(500).json({
      answer: "Something went wrong. Please try again."
    });
  }
});

/* ---------------- DEBUG ENDPOINT ---------------- */

app.get("/rag/stats", (req, res) => {
  res.json(vectorStore.getStats());
});

/* ---------------- SERVER ---------------- */

app.listen(3000, () => {
  console.log("🚀 Server running at http://localhost:3000");
});
