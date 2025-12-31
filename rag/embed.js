// embed.js
const { RecursiveCharacterTextSplitter } =
  require("@langchain/textsplitters");

async function chunkDocuments(docs, chunkSize = 500, chunkOverlap = 50) {
  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize,
    chunkOverlap,
    separators: ["\n\n", "\n", ". ", "! ", "? ", ", ", " ", ""],
  });
  
  const chunks = [];
  let chunkId = 0;
  
  for (const doc of docs) {
    // Preserve metadata in each chunk
    const chunkText = doc.content;
    const docChunks = await textSplitter.splitText(chunkText);
    
    docChunks.forEach((chunkText, index) => {
      chunks.push({
        id: `${doc.sourceId || "doc"}_${chunkId++}`,
        content: chunkText,
        metadata: {
          ...doc.metadata,
          chunkIndex: index,
          totalChunks: docChunks.length,
          originalField: doc.metadata?.field || "unknown"
        }
      });
    });
  }
  
  return chunks;
}

module.exports = chunkDocuments;