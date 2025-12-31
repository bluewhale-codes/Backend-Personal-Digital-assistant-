// loader.js
const fs = require("fs");
const path = require("path");

function loadOwnerData() {
  const filePath = path.join(__dirname, "../data/owner_profile.json");
  const raw = fs.readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);

  const documents = [];

  // Flatten nested objects recursively
  function flattenObject(obj, prefix = "", fieldPath = "") {
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = fieldPath ? `${fieldPath}.${key}` : key;
      
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        flattenObject(value, `${prefix}${key}: `, currentPath);
      } else {
        let content = `${prefix}${key}: `;
        if (Array.isArray(value)) {
          content += value.join(", ");
        } else if (value !== null && value !== undefined) {
          content += value.toString();
        }
        
        documents.push({
          content,
          metadata: {
            field: currentPath,
            dataType: Array.isArray(value) ? "array" : typeof value,
            source: "owner_profile.json"
          }
        });
      }
    }
  }

  flattenObject(data);
  
  // Also add full context chunks for better retrieval
  const fullContext = JSON.stringify(data, null, 2);
  documents.push({
    content: `Full personal profile: ${fullContext}`,
    metadata: {
      field: "full_profile",
      dataType: "object",
      source: "owner_profile.json",
      isFullContext: true
    }
  });

  return documents;
}

module.exports = loadOwnerData;