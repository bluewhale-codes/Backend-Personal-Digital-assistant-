// vectorStore.js — FIXED & ROBUST VERSION
const { pipeline } = require("@xenova/transformers");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "vectorDB.json");
const EMBEDDING_DIM = 384;

class VectorStore {
  constructor() {
    this.vectors = [];
    this.fieldIndex = {};
    this.embedder = null;
    this.isReady = false;
  }

  /* ---------------- EMBEDDER ---------------- */

  async initEmbedder() {
    if (this.embedder) return;

    console.log("🔹 Initializing embedder...");
    this.embedder = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
    this.isReady = true;
    console.log("✅ Embedder ready");
  }

  async embedText(text) {
    if (!this.isReady) {
      throw new Error("Embedder not initialized. Call initEmbedder() first.");
    }

    if (!text || typeof text !== "string") {
      throw new Error("Invalid text for embedding");
    }

    const output = await this.embedder(text, {
      pooling: "mean",
      normalize: true
    });

    return Array.from(output.data);
  }

  /* ---------------- BUILD STORE ---------------- */

  async buildVectorStore(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      throw new Error("Chunks array is empty or invalid");
    }

    await this.initEmbedder();
    this.vectors = [];

    console.log(`🔹 Building vector store from ${chunks.length} chunks`);

    for (const chunk of chunks) {
      if (!chunk.content) {
        console.warn("⚠️ Skipping invalid chunk:", chunk);
        continue;
      }

      const embedding = await this.embedText(chunk.content);

      this.vectors.push({
        id: chunk.id || `chunk_${this.vectors.length}`,
        content: chunk.content,
        embedding,
        metadata: chunk.metadata || {}
      });
    }

    this.buildIndex();
    this.saveToDisk();

    console.log(`✅ Vector store built: ${this.vectors.length} vectors`);
  }

  /* ---------------- INDEX ---------------- */

  buildIndex() {
    this.fieldIndex = {};

    this.vectors.forEach((vec, idx) => {
      const field = vec.metadata.field || "general";
      if (!this.fieldIndex[field]) {
        this.fieldIndex[field] = [];
      }
      this.fieldIndex[field].push(idx);
    });
  }

  /* ---------------- SEARCH ---------------- */

  cosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < EMBEDDING_DIM; i++) {
      dot += a[i] * b[i];
    }
    return dot;
  }

  async search(query, { topK = 3, minScore = 0.2 } = {}) {
    if (this.vectors.length === 0) {
      console.warn("⚠️ Vector store empty — skipping search");
      return [];
    }

    await this.initEmbedder();
    const queryEmbedding = await this.embedText(query);

    const scored = this.vectors.map(doc => ({
      ...doc,
      score: this.cosineSimilarity(queryEmbedding, doc.embedding)
    }));

    const results = scored
      .sort((a, b) => b.score - a.score)
      .filter(d => d.score >= minScore)
      .slice(0, topK);

    return results;
  }

  /* ---------------- DISK ---------------- */

  saveToDisk() {
    fs.writeFileSync(DB_PATH, JSON.stringify(this.vectors, null, 2));
    console.log("💾 Vector store saved");
  }

  loadFromDisk() {
    if (!fs.existsSync(DB_PATH)) return false;

    this.vectors = JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
    this.buildIndex();
    console.log(`📂 Loaded ${this.vectors.length} vectors`);
    return true;
  }

  /* ---------------- UTILS ---------------- */

  clear() {
    this.vectors = [];
    this.fieldIndex = {};
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  }

  stats() {
    return {
      vectors: this.vectors.length,
      fields: Object.keys(this.fieldIndex)
    };
  }
}

/* ---------------- EXPORT ---------------- */

const store = new VectorStore();

module.exports = store;
