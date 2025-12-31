const { pipeline } = require("@xenova/transformers");
const fs = require("fs");
const path = require("path");

// Singleton instance
class VectorStore {
  constructor() {
    this.embedder = null;
    this.vectors = [];
    this.fieldIndex = {};
    this.DB_PATH = path.join(__dirname, "./vectorDB.json");
  }

  async initEmbedder() {
    // Check if already initialized
    if (this.embedder) {
      console.log("Embedder already initialized");
      return;
    }
    
    console.log("Initializing embedder...");
    try {
      this.embedder = await pipeline(
        "feature-extraction",
        "Xenova/all-MiniLM-L6-v2"
      );
      console.log("✅ Embedder initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize embedder:", error);
      throw error;
    }
  }

  async embedText(text) {
    if (!this.embedder) {
      throw new Error("Embedder not initialized. Call initEmbedder() first.");
    }
    
    try {
      const output = await this.embedder(text, { 
        pooling: "mean", 
        normalize: true 
      });
      return Array.from(output.data);
    } catch (error) {
      console.error("Embedding error:", error);
      // Return zero vector as fallback (384 dimensions for all-MiniLM-L6-v2)
      return new Array(384).fill(0);
    }
  }

  async buildVectorStore(chunks) {
    console.log(`Building vector store with ${chunks.length} chunks...`);
    this.vectors = [];
    
    // Process in batches to avoid memory issues
    const batchSize = 10;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);
      console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(chunks.length/batchSize)}`);
      
      const promises = batch.map(async (chunk) => {
        const embedding = await this.embedText(chunk.content);
        return {
          ...chunk,
          embedding,
          timestamp: Date.now()
        };
      });
      
      const batchResults = await Promise.all(promises);
      this.vectors.push(...batchResults);
    }
    
    // Build simple index for faster search
    this.buildIndex();
    
    // Save to disk
    this.saveToDisk();
    
    console.log(`✅ Vector store built with ${this.vectors.length} vectors`);
  }

  buildIndex() {
    this.fieldIndex = {};
    this.vectors.forEach((vec, idx) => {
      const field = vec.metadata?.field || "unknown";
      if (!this.fieldIndex[field]) {
        this.fieldIndex[field] = [];
      }
      this.fieldIndex[field].push(idx);
    });
  }

  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dot / denominator;
  }

  async search(query, options = {}) {
    const {
      topK = 3,
      minScore = 0.2,
      fieldFilter = null,
      useReranking = false
    } = options;
    
    if (this.vectors.length === 0) {
      console.log("No vectors in store");
      return [];
    }
    
    const queryEmbedding = await this.embedText(query);
    
    // Filter by field if specified
    let candidates = this.vectors;
    if (fieldFilter && this.fieldIndex[fieldFilter]) {
      candidates = this.fieldIndex[fieldFilter].map(idx => this.vectors[idx]);
    }
    
    // Score all candidates
    const scored = candidates.map(doc => ({
      ...doc,
      score: this.cosineSimilarity(queryEmbedding, doc.embedding)
    }));
    
    // Sort and filter
    let results = scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK * 2)
      .filter(item => item.score > minScore);
    
    // Simple reranking
    if (useReranking && results.length > 0) {
      const queryLower = query.toLowerCase();
      results = results.map(doc => {
        let boostedScore = doc.score;
        const field = doc.metadata?.field || "";
        
        // Boost if query contains field name
        if (field.toLowerCase().includes(queryLower) || 
            queryLower.includes(field.toLowerCase())) {
          boostedScore *= 1.2;
        }
        
        // Boost full context chunks for broad questions
        if (doc.metadata?.isFullContext && query.split(" ").length < 4) {
          boostedScore *= 1.1;
        }
        
        return { ...doc, score: boostedScore };
      }).sort((a, b) => b.score - a.score);
    }
    
    return results.slice(0, topK);
  }

  saveToDisk() {
    try {
      // Only save essential data
      const saveData = this.vectors.map(vec => ({
        id: vec.id,
        content: vec.content,
        embedding: vec.embedding,
        metadata: vec.metadata
      }));
      
      fs.writeFileSync(this.DB_PATH, JSON.stringify(saveData, null, 2));
      console.log(`✅ Vector store saved to ${this.DB_PATH}`);
    } catch (error) {
      console.error("Failed to save vector store:", error);
    }
  }

  loadFromDisk() {
    try {
      if (fs.existsSync(this.DB_PATH)) {
        console.log("Loading vector store from disk...");
        const data = JSON.parse(fs.readFileSync(this.DB_PATH, "utf-8"));
        this.vectors = data;
        this.buildIndex();
        console.log(`✅ Loaded ${this.vectors.length} vectors from disk`);
        return true;
      } else {
        console.log("No existing vector store found on disk");
        return false;
      }
    } catch (error) {
      console.error("Failed to load vector store:", error);
      return false;
    }
  }

  async addDocument(content, metadata = {}) {
    const embedding = await this.embedText(content);
    const newDoc = {
      id: `doc_${Date.now()}_${this.vectors.length}`,
      content,
      embedding,
      metadata: { ...metadata, addedAt: Date.now() },
      timestamp: Date.now()
    };
    
    this.vectors.push(newDoc);
    this.buildIndex();
    this.saveToDisk();
    
    return newDoc;
  }

  clear() {
    this.vectors = [];
    this.fieldIndex = {};
    if (fs.existsSync(this.DB_PATH)) {
      fs.unlinkSync(this.DB_PATH);
    }
    console.log("Vector store cleared");
  }

  getStats() {
    return {
      totalVectors: this.vectors.length,
      fields: Object.keys(this.fieldIndex || {}),
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024
    };
  }
}

// Create a single instance
const vectorStoreInstance = new VectorStore();

// Export methods bound to the instance
module.exports = {
  // Initialize methods
  initEmbedder: () => vectorStoreInstance.initEmbedder(),
  buildVectorStore: (chunks) => vectorStoreInstance.buildVectorStore(chunks),
  
  // Search methods
  search: (query, options) => vectorStoreInstance.search(query, options),
  
  // Management methods
  addDocument: (content, metadata) => vectorStoreInstance.addDocument(content, metadata),
  loadFromDisk: () => vectorStoreInstance.loadFromDisk(),
  clear: () => vectorStoreInstance.clear(),
  getStats: () => vectorStoreInstance.getStats(),
  
  // Get the instance (for debugging)
  _getInstance: () => vectorStoreInstance
};