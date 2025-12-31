const { pipeline } = require("@xenova/transformers");
const fs = require("fs");
const path = require("path");

class VectorStore {
  constructor() {
    this.embedder = null;
    this.vectors = [];
    this.fieldIndex = {};
    this.DB_PATH = path.join(__dirname, "./vectorDB.json");
  }

  /* ---------------- EMBEDDER ---------------- */

  async initEmbedder() {
    if (this.embedder) {
      console.log("ℹ️ Embedder already initialized");
      return;
    }

    console.log("🔹 Initializing embedder...");
    this.embedder = await pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2"
    );
    console.log("✅ Embedder initialized successfully");
  }

  async embedText(text) {
    if (!this.embedder) {
      throw new Error("Embedder not initialized");
    }

    const output = await this.embedder(text, {
      pooling: "mean",
      normalize: true
    });

    return Array.from(output.data);
  }

  /* ---------------- VECTOR STORE ---------------- */

  async buildVectorStore(chunks) {
    if (!Array.isArray(chunks) || chunks.length === 0) {
      throw new Error("No chunks provided to buildVectorStore()");
    }

    console.log(`🔹 Building vector store from ${chunks.length} chunks`);
    this.vectors = [];

    for (const chunk of chunks) {
      if (!chunk.content) continue;

      const embedding = await this.embedText(chunk.content);

      this.vectors.push({
        id: chunk.id,
        content: chunk.content,
        embedding,
        metadata: {
          field: chunk.field || "general"
        }
      });
    }

    this.buildIndex();
    this.saveToDisk();

    console.log(`✅ Vector store built: ${this.vectors.length} vectors`);
  }

  buildIndex() {
    this.fieldIndex = {};

    for (let i = 0; i < this.vectors.length; i++) {
      const field = this.vectors[i].metadata.field;

      if (!this.fieldIndex[field]) {
        this.fieldIndex[field] = [];
      }
      this.fieldIndex[field].push(i);
    }
  }

  /* ---------------- SEARCH ---------------- */

  cosineSimilarity(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  async search(query, { topK = 3, minScore = 0.25 } = {}) {
    if (!this.embedder) {
      throw new Error("Embedder not initialized");
    }

    if (this.vectors.length === 0) {
      console.warn("⚠️ Vector store empty — skipping search");
      return [];
    }

    const queryEmbedding = await this.embedText(query);

    return this.vectors
      .map(v => ({
        ...v,
        score: this.cosineSimilarity(queryEmbedding, v.embedding)
      }))
      .filter(v => v.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /* ---------------- PERSISTENCE ---------------- */

  saveToDisk() {
    fs.writeFileSync(
      this.DB_PATH,
      JSON.stringify(this.vectors, null, 2)
    );
    console.log("💾 Vector store saved");
  }

  loadFromDisk() {
    if (!fs.existsSync(this.DB_PATH)) {
      return false;
    }

    const data = JSON.parse(fs.readFileSync(this.DB_PATH, "utf-8"));

    if (!Array.isArray(data) || data.length === 0) {
      return false;
    }

    // Normalize legacy data
    this.vectors = data.map(v => ({
      ...v,
      metadata: v.metadata || { field: "general" }
    }));

    this.buildIndex();
    console.log(`📂 Loaded ${this.vectors.length} vectors from disk`);
    return true;
  }

  /* ---------------- UTILS ---------------- */

  clear() {
    this.vectors = [];
    this.fieldIndex = {};
    if (fs.existsSync(this.DB_PATH)) fs.unlinkSync(this.DB_PATH);
  }

  getStats() {
    return {
      vectors: this.vectors.length,
      fields: Object.keys(this.fieldIndex)
    };
  }
}

const instance = new VectorStore();

module.exports = {
  initEmbedder: () => instance.initEmbedder(),
  buildVectorStore: chunks => instance.buildVectorStore(chunks),
  search: (q, opts) => instance.search(q, opts),
  loadFromDisk: () => instance.loadFromDisk(),
  clear: () => instance.clear(),
  getStats: () => instance.getStats()
};
