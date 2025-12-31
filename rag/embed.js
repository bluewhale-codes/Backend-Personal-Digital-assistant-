function chunkDocuments(docs) {
  if (!Array.isArray(docs) || docs.length === 0) {
    console.warn("⚠️ No documents to chunk");
    return [];
  }

  return docs.map((doc, index) => ({
    id: `chunk_${index}`,
    content: doc.content,
    field: doc.field || "general"
  }));
}

module.exports = chunkDocuments;
