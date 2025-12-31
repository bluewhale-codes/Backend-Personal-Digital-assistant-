const express = require("express");
const Groq = require("groq-sdk");
const nodemailer = require("nodemailer");
require("dotenv").config();

const cors = require("cors");

const loadOwnerData = require("./rag/loader");
const chunkDocuments = require("./rag/embed");
const { initEmbedder, buildVectorStore, search, loadFromDisk, getStats } = require("./rag/vectorStore");

const app = express();
app.use(express.json());

app.use(
  cors({
    origin: ["http://localhost:5173", "https://new-bees-ecommerce.vercel.app"],
    credentials: true
  })
);

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

// ========== EMAIL CONFIGURATION ==========
// Create email transporter
const createTransporter = () => {
  const emailConfig = {
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    }
  };
  
  return nodemailer.createTransport(emailConfig);
};

// 🔧 IMPROVED Server-side Tools Registry
const serverTools = {
  searchNotes: {
    name: "search_notes",
    description: "Search through owner's personal notes and documents",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query for notes"
        },
        maxResults: {
          type: "number",
          description: "Maximum number of results to return",
          default: 3
        }
      },
      required: ["query"]
    },
    execute: async ({ query, maxResults = 3 }) => {
      console.log(`🔍 Searching notes for: "${query}"`);
      const results = await search(query, { topK: maxResults });
      return {
        found: results.length,
        notes: results.map(r => ({
          content: r.content.length > 150 ? r.content.substring(0, 150) + "..." : r.content,
          relevance: r.score ? r.score.toFixed(2) : "N/A",
          source: r.metadata?.field || "unknown"
        }))
      };
    }
  },

  getProfileData: {
    name: "get_profile_data",
    description: "Fetch structured data about the owner",
    parameters: {
      type: "object",
      properties: {
        dataType: {
          type: "string",
          enum: ["personal_info", "skills", "hobbies", "work_experience", "education", "all", "about"],
          description: "Type of profile data to fetch"
        }
      },
      required: ["dataType"]
    },
    execute: async ({ dataType = "about" }) => {
      console.log(`📊 Fetching profile data: ${dataType}`);
      try {
        const ownerData = require("./data/owner_profile.json");
        
        if (dataType === "all") {
          return {
            dataType: "all",
            data: ownerData,
            summary: "Complete profile information",
            timestamp: new Date().toISOString()
          };
        } else if (dataType === "about") {
          // Create a friendly "about me" response
          const personalInfo = ownerData.personal_info || {};
          const skills = ownerData.skills || [];
          const hobbies = ownerData.hobbies || [];
          
          const aboutText = `Hello! I'm ${personalInfo.name || "your personal assistant"}. ${
            personalInfo.title ? `I'm a ${personalInfo.title}. ` : ""
          }${
            personalInfo.location ? `Based in ${personalInfo.location}. ` : ""
          }${
            skills.length > 0 ? `My skills include: ${skills.join(", ")}. ` : ""
          }${
            hobbies.length > 0 ? `In my free time, I enjoy ${hobbies.join(", ")}. ` : ""
          }${
            ownerData.work_experience ? `Professionally, ${ownerData.work_experience}. ` : ""
          }${
            ownerData.education ? `Education: ${ownerData.education}. ` : ""
          }`;
          
          return {
            dataType: "about",
            data: aboutText.trim(),
            timestamp: new Date().toISOString()
          };
        } else {
          const data = ownerData[dataType] || { message: "No data available for this category" };
          return {
            dataType: dataType,
            data: data,
            timestamp: new Date().toISOString()
          };
        }
      } catch (error) {
        console.error("❌ Error loading profile data:", error);
        return {
          dataType: dataType,
          error: "Unable to load profile data",
          message: "Please check if owner_profile.json exists and is properly formatted",
          timestamp: new Date().toISOString()
        };
      }
    }
  },

  calculate: {
    name: "calculate",
    description: "Perform mathematical calculations",
    parameters: {
      type: "object",
      properties: {
        expression: {
          type: "string",
          description: "Mathematical expression to evaluate"
        }
      },
      required: ["expression"]
    },
    execute: async ({ expression }) => {
      console.log(`🧮 Calculating: ${expression}`);
      
      try {
        // Safe evaluation without external library
        const safeEval = (expr) => {
          // Remove any non-math characters for safety
          const cleanExpr = expr.replace(/[^0-9+\-*/().\s]/g, '');
          try {
            // eslint-disable-next-line no-new-func
            return Function(`"use strict"; return (${cleanExpr})`)();
          } catch (e) {
            throw new Error("Invalid expression");
          }
        };

        const result = safeEval(expression);
        return {
          expression,
          result: result.toString(),
          formatted: `${expression} = ${result}`,
          type: typeof result
        };
      } catch (error) {
        console.error("Calculation error:", error);
        return {
          error: "Invalid mathematical expression",
          details: error.message,
          suggestion: "Please provide a valid math expression like '23 + 4' or '5 * 10'"
        };
      }
    }
  },

  getCurrentTime: {
    name: "get_current_time",
    description: "Get current date and time",
    parameters: {
      type: "object",
      properties: {
        format: {
          type: "string",
          enum: ["timestamp", "readable", "both"],
          default: "readable"
        }
      }
    },
    execute: async ({ format = "readable" }) => {
      console.log(`⏰ Getting current time (format: ${format})`);
      const now = new Date();
      
      if (format === "timestamp") {
        return { 
          timestamp: now.toISOString(),
          message: `ISO Timestamp: ${now.toISOString()}`
        };
      } else if (format === "readable") {
        return {
          readable: now.toLocaleString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          message: `Current time: ${now.toLocaleString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`
        };
      } else {
        return {
          timestamp: now.toISOString(),
          readable: now.toLocaleString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          message: `${now.toLocaleString()} (ISO: ${now.toISOString()})`
        };
      }
    }
  },
  sendEmail: {
    name: "send_email",
    description: "Send an email from your account to a recipient",
    parameters: {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address"
        },
        subject: {
          type: "string",
          description: "Email subject"
        },
        body: {
          type: "string",
          description: "Email body content"
        },
        cc: {
          type: "string",
          description: "CC email addresses (comma separated, optional)"
        },
        bcc: {
          type: "string",
          description: "BCC email addresses (comma separated, optional)"
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high"],
          default: "normal",
          description: "Email priority"
        }
      },
      required: ["to", "subject", "body"]
    },
    execute: async ({ to, subject, body, cc, bcc, priority = "normal" }) => {
      console.log(`📧 Sending email to: ${to}`);
      console.log(`📝 Subject: ${subject}`);
      
      try {
        // Validate email addresses
        const validateEmail = (email) => {
          const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          return re.test(email.trim());
        };

        if (!validateEmail(to)) {
          throw new Error(`Invalid recipient email: ${to}`);
        }

        // Create email transporter
        const transporter = createTransporter();
        
        if (!transporter) {
          throw new Error("Email service not configured. Please check EMAIL_USER and EMAIL_PASSWORD in .env file");
        }

        // Prepare email options
        const mailOptions = {
          from: {
            name: process.env.EMAIL_SENDER_NAME || 'Your Personal Assistant',
            address: process.env.EMAIL_USER
          },
          to: to.trim(),
          subject: subject,
          text: body,
          html: `
            <!DOCTYPE html>
            <html>
            <head>
              <meta charset="utf-8">
              <title>${subject}</title>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #f4f4f4; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
                .content { padding: 20px; border: 1px solid #ddd; border-radius: 5px; }
                .footer { margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; color: #666; font-size: 12px; }
                .priority-${priority} { 
                  display: inline-block; 
                  padding: 3px 8px; 
                  border-radius: 3px; 
                  font-size: 12px; 
                  font-weight: bold;
                  ${priority === 'high' ? 'background: #ffcccc; color: #cc0000;' : 
                   priority === 'normal' ? 'background: #e6f7ff; color: #0066cc;' : 
                   'background: #f0f0f0; color: #666;'}
                }
              </style>
            </head>
            <body>
              <div class="header">
                <h2>${subject}</h2>
                <span class="priority-${priority}">Priority: ${priority.toUpperCase()}</span>
              </div>
              <div class="content">
                ${body.replace(/\n/g, '<br>')}
              </div>
              <div class="footer">
                <p>This email was sent by your Personal AI Assistant</p>
                <p>Sent: ${new Date().toLocaleString()}</p>
                <p>Note: This is an automated message. Please do not reply to this email.</p>
              </div>
            </body>
            </html>
          `,
          priority: priority === 'high' ? 'high' : priority === 'low' ? 'low' : 'normal'
        };

        // Add CC if provided
        if (cc) {
          const ccEmails = cc.split(',').map(e => e.trim()).filter(validateEmail);
          if (ccEmails.length > 0) {
            mailOptions.cc = ccEmails;
          }
        }

        // Add BCC if provided
        if (bcc) {
          const bccEmails = bcc.split(',').map(e => e.trim()).filter(validateEmail);
          if (bccEmails.length > 0) {
            mailOptions.bcc = bccEmails;
          }
        }

        // Send email
        const info = await transporter.sendMail(mailOptions);
        
        console.log(`✅ Email sent successfully!`);
        console.log(`📨 Message ID: ${info.messageId}`);
        
        return {
          success: true,
          messageId: info.messageId,
          to: to,
          subject: subject,
          sentAt: new Date().toISOString(),
          previewUrl: nodemailer.getTestMessageUrl(info) || null,
          priority: priority,
          message: `Email sent successfully to ${to}`
        };
        
      } catch (error) {
        console.error(`❌ Email sending failed:`, error);
        
        let errorMessage = error.message;
        if (error.code === 'EAUTH') {
          errorMessage = "Authentication failed. Please check your email credentials in the .env file.";
        } else if (error.code === 'EENVELOPE') {
          errorMessage = "Invalid email address. Please check the recipient email.";
        } else if (error.message.includes('Invalid login')) {
          errorMessage = "Invalid email credentials. For Gmail, you might need an 'App Password' instead of your regular password.";
        }
        
        return {
          success: false,
          error: errorMessage,
          details: error.toString(),
          suggestion: "Make sure EMAIL_USER and EMAIL_PASSWORD are correctly set in your .env file"
        };
      }
    }
  },
};

// ========== EMAIL TEMPLATE TOOL ==========
serverTools.sendEmailTemplate = {
  name: "send_email_template",
  description: "Send an email using a predefined template",
  parameters: {
    type: "object",
    properties: {
      to: {
        type: "string",
        description: "Recipient email address"
      },
      template: {
        type: "string",
        enum: ["meeting", "reminder", "followup", "thankyou", "custom"],
        description: "Email template to use"
      },
      recipientName: {
        type: "string",
        description: "Recipient's name"
      },
      customSubject: {
        type: "string",
        description: "Custom subject (optional, overrides template)"
      },
      customMessage: {
        type: "string",
        description: "Custom message (optional, appended to template)"
      },
      date: {
        type: "string",
        description: "Date for meeting/reminder (format: YYYY-MM-DD HH:MM)"
      }
    },
    required: ["to", "template", "recipientName"]
  },
  execute: async ({ to, template, recipientName, customSubject, customMessage, date }) => {
    console.log(`📧 Sending ${template} template email to: ${to}`);
    
    const templates = {
      meeting: {
        subject: `Meeting Invitation - ${date || 'TBD'}`,
        body: `Hello ${recipientName},\n\nI would like to schedule a meeting with you on ${date || 'a suitable time'}.\n\nPlease let me know your availability.\n\nBest regards,\n${process.env.EMAIL_SENDER_NAME || 'Your Name'}`
      },
      reminder: {
        subject: `Reminder: Important Update`,
        body: `Hi ${recipientName},\n\nThis is a friendly reminder about our upcoming discussion.\n\n${date ? `Scheduled for: ${date}\n\n` : ''}Looking forward to connecting with you.\n\nBest,\n${process.env.EMAIL_SENDER_NAME || 'Your Name'}`
      },
      followup: {
        subject: `Follow-up on Our Conversation`,
        body: `Dear ${recipientName},\n\nI'm following up on our recent conversation. Please let me know if you have any updates or questions.\n\nThank you,\n${process.env.EMAIL_SENDER_NAME || 'Your Name'}`
      },
      thankyou: {
        subject: `Thank You!`,
        body: `Dear ${recipientName},\n\nThank you for your time and consideration. I appreciate our conversation.\n\nWarm regards,\n${process.env.EMAIL_SENDER_NAME || 'Your Name'}`
      }
    };

    const selectedTemplate = templates[template] || {
      subject: customSubject || `Message from ${process.env.EMAIL_SENDER_NAME || 'Your Name'}`,
      body: customMessage || `Hello ${recipientName},\n\n${customMessage || 'I wanted to reach out to you.'}\n\nBest regards,\n${process.env.EMAIL_SENDER_NAME || 'Your Name'}`
    };

    // Use the main sendEmail tool
    return await serverTools.sendEmail.execute({
      to: to,
      subject: customSubject || selectedTemplate.subject,
      body: selectedTemplate.body + (customMessage ? `\n\nAdditional Note:\n${customMessage}` : ''),
      priority: 'normal'
    });
  }
};

// ========== EMAIL VALIDATION TOOL ==========
serverTools.validateEmail = {
  name: "validate_email",
  description: "Validate an email address format",
  parameters: {
    type: "object",
    properties: {
      email: {
        type: "string",
        description: "Email address to validate"
      }
    },
    required: ["email"]
  },
  execute: async ({ email }) => {
    console.log(`🔍 Validating email: ${email}`);
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const isValid = emailRegex.test(email);
    
    // Check domain
    let domainCheck = null;
    if (isValid) {
      const domain = email.split('@')[1];
      const commonDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'];
      domainCheck = {
        domain: domain,
        isCommon: commonDomains.includes(domain.toLowerCase()),
        suggestion: commonDomains.includes(domain.toLowerCase()) ? 
          'Valid common email domain' : 
          'Valid but uncommon domain'
      };
    }
    
    return {
      email: email,
      isValid: isValid,
      validationMessage: isValid ? 'Valid email format' : 'Invalid email format',
      domainCheck: domainCheck,
      suggestion: isValid ? 
        'Email format is valid. You can proceed to send.' : 
        'Please check the email address format (should be user@domain.com)'
    };
  }
};

// 🔧 FIXED Tool calling utilities
async function executeToolCall(toolCall) {
  const { name, arguments: args } = toolCall;
  
  // Find the tool by its name property (not the object key)
  const toolEntries = Object.entries(serverTools);
  const toolEntry = toolEntries.find(([_, toolObj]) => toolObj.name === name);
  
  if (!toolEntry) {
    throw new Error(`Tool "${name}" not found. Available tools: ${toolEntries.map(([_, t]) => t.name).join(', ')}`);
  }
  
  const [toolKey, tool] = toolEntry;
  
  console.log(`🛠️ Executing tool: ${name} (key: ${toolKey})`);
  console.log(`📋 Arguments:`, args);
  
  try {
    // Handle missing dataType for get_profile_data
    if (name === "get_profile_data" && (!args || Object.keys(args).length === 0)) {
      args.dataType = "about";
      console.log(`🔄 Auto-setting dataType to "about" for get_profile_data`);
    }
    
    const result = await tool.execute(args);
    console.log(`✅ Tool ${name} executed successfully`);
    return result;
  } catch (error) {
    console.error(`❌ Tool ${name} failed:`, error);
    return { 
      error: `Tool execution failed: ${error.message}`,
      tool: name,
      arguments: args
    };
  }
}

// 🔒 IMPROVED Hard Guard - ALLOW PERSONAL QUESTIONS
function shouldRejectQuestion(prompt) {
  const lower = prompt.toLowerCase().trim();
  
  // Always allow personal questions
  const personalIndicators = [
    "my", "your", "me", "i ", "mine", "myself", "our", "we", 
    "you", "yourself", "tell me about yourself", "who are you",
    "what are you", "introduce yourself", "about yourself",
    "about you", "your skills", "your hobbies", "your experience"
  ];
  
  const isPersonal = personalIndicators.some(word => lower.includes(word));
  if (isPersonal) {
    console.log("✅ Personal question detected - allowing");
    return false;
  }
  
  // Allow math questions
  const mathPatterns = [
    /^\d+\s*[\+\-\*\/]\s*\d+/,
    /^calculate\s+/,
    /^what is\s+\d+\s*[\+\-\*\/]\s*\d+/,
    /^solve\s+\d/,
    /^\d+\s*plus\s*\d+/,
    /\d+\s*minus\s*\d+/,
    /\d+\s*times\s*\d+/,
    /\d+\s*divided by\s*\d+/
  ];
  
  const isMathQuestion = mathPatterns.some(pattern => pattern.test(lower));
  if (isMathQuestion) {
    console.log("🔢 Math question detected - allowing");
    return false;
  }
  
  // Allow email-related questions
  const emailPatterns = [
    /send.*email/,
    /email.*to/,
    /send.*to.*email/,
    /write.*email/,
    /compose.*email/,
    /mail.*to/
  ];
  
  const isEmailQuestion = emailPatterns.some(pattern => pattern.test(lower));
  if (isEmailQuestion) {
    console.log("📧 Email question detected - allowing");
    return false;
  }
  
  // Allow time questions
  if (lower.includes("time") || lower.includes("date") || lower.includes("current time")) {
    console.log("⏰ Time/date question detected - allowing");
    return false;
  }
  
  // Block general knowledge questions
  const blockedPatterns = [
    /^what is (?!\d|your|my)/,
    /^who is (?!you)/,
    /^explain\s+/,
    /^define\s+/,
    /^describe\s+/,
    /^how does\s+/,
    /^tell me about (?!your|you)/,
    /^what are (?!your|my|you)/
  ];
  
  return blockedPatterns.some(pattern => pattern.test(lower));
}

// Also, update the SYSTEM_PROMPT to be more specific about JSON formatting:
const SYSTEM_PROMPT = `You are a personal AI assistant with access to tools.

AVAILABLE TOOLS:
${Object.values(serverTools).map(tool => `
- ${tool.name}: ${tool.description}
  Parameters: ${JSON.stringify(tool.parameters.properties)}
  Required: ${tool.parameters.required?.join(', ') || 'none'}
`).join('')}

IMPORTANT RULES:
1. When user asks to send an email, you MUST provide ALL required parameters: to, subject, and body
2. If user provides incomplete email information (like only the recipient), ask for the missing parts
3. Do NOT send emails with empty subject or body
4. When asking for missing information, respond normally (not as a tool call)

TOOL CALLING FORMAT:
When you need to use a tool AND have ALL required information, respond EXACTLY with valid JSON:
TOOL_CALL:{"name":"tool_name","arguments":{"arg1":"value1","arg2":"value2"}}

IMPORTANT: The JSON must be valid:
- Use double quotes for property names and string values
- No trailing commas
- Properly escaped strings

EMAIL EXAMPLES:
1. Complete request: "Send email to john@gmail.com with subject 'Meeting' and body 'Hello, let's meet tomorrow'"
   Response: TOOL_CALL:{"name":"send_email","arguments":{"to":"john@gmail.com","subject":"Meeting","body":"Hello, let's meet tomorrow"}}

2. Incomplete request: "Send email to john@gmail.com"
   Response: "I'd be happy to send an email. What should the subject be, and what would you like to say in the body?"

3. Partial request: "Send email to john@gmail.com about meeting"
   Response: "I'll send an email to john@gmail.com about a meeting. What should the subject line be, and what would you like to say in the email?"

CONTEXT FROM PERSONAL DATA:
{context}

Remember: Only use TOOL_CALL format when you have ALL required information. Otherwise, ask for missing information in a normal response.`;
// Helper function to detect tool calls
// Replace the parseToolCall function with this improved version:
function parseToolCall(response) {
  if (!response) return null;
  
  console.log("🔍 Parsing LLM response:", response.substring(0, 200) + (response.length > 200 ? "..." : ""));
  
  // Clean the response - remove any non-JSON content before and after
  const cleanResponse = response.trim();
  
  // Try to find TOOL_CALL pattern
  const toolCallMatch = cleanResponse.match(/TOOL_CALL:\s*(\{[\s\S]*?\})(?=\s|$)/);
  if (toolCallMatch && toolCallMatch[1]) {
    try {
      // Clean the JSON string before parsing
      let jsonStr = toolCallMatch[1];
      
      // Remove trailing commas
      jsonStr = jsonStr.replace(/,\s*}/g, '}').replace(/,\s*]/g, ']');
      
      // Fix common JSON issues
      jsonStr = jsonStr.replace(/(\w+):/g, '"$1":'); // Add quotes to property names if missing
      jsonStr = jsonStr.replace(/'/g, '"'); // Replace single quotes with double quotes
      
      const toolCall = JSON.parse(jsonStr);
      console.log("✅ Parsed tool call from TOOL_CALL pattern:", toolCall);
      
      if (toolCall.name) {
        // Ensure arguments is an object
        if (!toolCall.arguments || typeof toolCall.arguments !== 'object') {
          toolCall.arguments = {};
        }
        return toolCall;
      }
    } catch (error) {
      console.error("❌ Failed to parse tool call JSON:", error.message);
      console.error("Raw JSON string:", toolCallMatch[1]);
    }
  }
  
  // Try to extract JSON from the response using a more robust approach
  const jsonStart = cleanResponse.indexOf('{');
  const jsonEnd = cleanResponse.lastIndexOf('}');
  
  if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
    const potentialJson = cleanResponse.substring(jsonStart, jsonEnd + 1);
    
    try {
      // Clean the JSON
      let cleanedJson = potentialJson
        .replace(/(\w+):/g, '"$1":') // Add quotes to property names
        .replace(/'/g, '"') // Replace single quotes
        .replace(/,\s*}/g, '}') // Remove trailing commas
        .replace(/,\s*]/g, ']')
        .replace(/,\s*,/g, ',') // Remove duplicate commas
        .trim();
      
      // Try to fix common issues
      cleanedJson = cleanedJson.replace(/"(\w+)":\s*""/g, '"$1": ""'); // Ensure empty strings are properly quoted
      
      const toolCall = JSON.parse(cleanedJson);
      
      if (toolCall && toolCall.name) {
        console.log("✅ Parsed tool call from JSON extraction:", toolCall);
        if (!toolCall.arguments || typeof toolCall.arguments !== 'object') {
          toolCall.arguments = {};
        }
        return toolCall;
      }
    } catch (error) {
      // If JSON parsing fails, try a more aggressive cleanup
      try {
        // Extract just the tool name and arguments pattern
        const nameMatch = potentialJson.match(/"name"\s*:\s*"([^"]+)"/);
        const argsMatch = potentialJson.match(/"arguments"\s*:\s*(\{.*\})/);
        
        if (nameMatch && argsMatch) {
          const toolName = nameMatch[1];
          let argsStr = argsMatch[1];
          
          // Clean up the arguments JSON
          argsStr = argsStr.replace(/(\w+):/g, '"$1":')
                         .replace(/'/g, '"')
                         .replace(/,\s*}/g, '}')
                         .replace(/,\s*]/g, ']');
          
          const argumentsObj = JSON.parse(argsStr);
          
          return {
            name: toolName,
            arguments: argumentsObj
          };
        }
      } catch (innerError) {
        console.error("❌ Could not extract tool call from malformed JSON:", innerError.message);
      }
    }
  }
  
  console.log("❌ No valid tool call detected");
  return null;
}
// 🚀 Initialize RAG
(async () => {
  try {
    console.log("🔄 Initializing RAG system...");
    
    await initEmbedder();
    console.log("✅ Embedder initialized");
    
    const loaded = loadFromDisk();
    
    if (!loaded) {
      console.log("📂 Building vector store from scratch...");
      const docs = loadOwnerData();
      const chunks = chunkDocuments(docs);
      await buildVectorStore(chunks);
      console.log("✅ Vector store built successfully");
    } else {
      console.log("✅ Using existing vector store");
    }
    
    const stats = getStats();
    console.log("📊 RAG Stats:", stats);
    console.log("✅ RAG Vector Store Initialized");
  } catch (error) {
    console.error("❌ Failed to initialize RAG:", error);
    console.log("⚠️ Continuing without RAG - some features may be limited");
  }
})();

// ========== MAIN ASK ENDPOINT ==========
app.post("/ask", async (req, res) => {
  const { prompt } = req.body;

  if (!prompt) {
    return res.status(400).json({ 
      error: "Prompt is required",
      suggestion: "Please provide a question or command"
    });
  }

  console.log("\n" + "=".repeat(50));
  console.log(`📨 New query: "${prompt}"`);
  
  try {
    // 🔒 Apply Hard Guard
    if (shouldRejectQuestion(prompt)) {
      console.log("🚫 Blocked by Hard Guard");
      return res.json({
        answer: "I'm designed to help with personal matters only. I can assist with emails, calculations, your personal information, and searching your notes.",
        tool_used: false,
        blocked: true,
        suggestion: "Try asking about: sending emails, your profile, calculations, or searching your notes"
      });
    }

    console.log("✅ Passed Hard Guard");
    
    // Special handling for incomplete email requests
    const lowerPrompt = prompt.toLowerCase();
    const isEmailRequest = lowerPrompt.includes("send email") || lowerPrompt.includes("send mail") || 
                          lowerPrompt.includes("email to") || lowerPrompt.includes("mail to");
    
    if (isEmailRequest) {
      // Extract email if provided
      const emailMatch = prompt.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/i);
      const hasEmail = !!emailMatch;
      
      // Check if subject is mentioned
      const hasSubject = lowerPrompt.includes("subject") || lowerPrompt.includes("about") || 
                        lowerPrompt.match(/with (?:the )?(?:subject|title) (?:of )?["']?([^"']+)["']?/i);
      
      // Check if body/content is mentioned
      const hasBody = lowerPrompt.includes("body") || lowerPrompt.includes("content") || 
                     lowerPrompt.includes("say") || lowerPrompt.includes("message") ||
                     lowerPrompt.match(/that says["']?([^"']+)["']?/i);
      
      console.log(`📧 Email request analysis:`, {
        hasEmail,
        hasSubject: !!hasSubject,
        hasBody: !!hasBody
      });
      
      // If missing critical information, ask for it directly instead of using LLM
      if (!hasEmail) {
        console.log("📧 Missing recipient email - asking directly");
        return res.json({
          answer: "I'd be happy to send an email. Who should I send it to? Please provide the recipient's email address.",
          tool_used: false,
          missing_info: "recipient_email"
        });
      }
      
      if (!hasSubject) {
        console.log("📧 Missing subject - asking directly");
        return res.json({
          answer: `I'll send an email to ${emailMatch[0]}. What should the subject line be?`,
          tool_used: false,
          missing_info: "subject",
          recipient: emailMatch[0]
        });
      }
      
      if (!hasBody) {
        console.log("📧 Missing body - asking directly");
        return res.json({
          answer: `I'll send an email to ${emailMatch[0]}. What would you like to say in the email?`,
          tool_used: false,
          missing_info: "body",
          recipient: emailMatch[0]
        });
      }
    }
    
    // 🔍 Get RAG context
    let context = "";
    try {
      const results = await search(prompt);
      if (results && results.length > 0) {
        context = results.slice(0, 2).map(r => r.content).join("\n\n");
        console.log("🔍 Found RAG context:", results.length, "chunks");
      } else {
        context = "No specific personal data found for this query.";
        console.log("🔍 No RAG context found");
      }
    } catch (ragError) {
      console.error("RAG search failed:", ragError);
      context = "Unable to search personal data at the moment.";
    }

    // Prepare system prompt
    const systemPromptWithContext = SYSTEM_PROMPT.replace("{context}", context || "No personal data available.");
    
    console.log("🤖 Calling LLM with tool instructions...");
    
    // Call LLM with tool instructions
    const completion = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
      messages: [
        {
          role: "system",
          content: systemPromptWithContext
        },
        {
          role: "user",
          content: prompt
        }
      ],
      temperature: 0.1, // Lower temperature for more consistent JSON
      max_tokens: 500
    });

    const llmResponse = completion.choices[0].message.content;
    console.log("🤖 LLM Raw Response:", llmResponse);

    // Check if tool call is needed
    const toolCall = parseToolCall(llmResponse);
    
    if (toolCall) {
      console.log(`🔄 Tool call detected: ${toolCall.name}`);
      
      // Special handling for email tool with empty fields
      if (toolCall.name === "send_email" || toolCall.name === "send_email_template") {
        const args = toolCall.arguments || {};
        
        // Check for empty required fields
        if (!args.to || !args.subject || !args.body) {
          console.log("❌ Email tool called with missing required fields");
          
          let missingFields = [];
          if (!args.to) missingFields.push("recipient email (to)");
          if (!args.subject || args.subject.trim() === "") missingFields.push("subject");
          if (!args.body || args.body.trim() === "") missingFields.push("body/content");
          
          return res.json({
            answer: `I need more information to send the email. Please provide: ${missingFields.join(", ")}.`,
            tool_used: false,
            missing_fields: missingFields,
            provided_args: args
          });
        }
      }
      
      // Execute the tool
      const toolResult = await executeToolCall(toolCall);
      
      // If tool execution failed, return error
      if (toolResult.error) {
        return res.json({
          answer: `I tried to use ${toolCall.name}, but encountered an error: ${toolResult.error}`,
          tool_used: true,
          tool_name: toolCall.name,
          tool_error: toolResult.error,
          tool_result: toolResult
        });
      }
      
      // Format response based on tool result
      let answer = "";
      
      switch (toolCall.name) {
        case "calculate":
          answer = toolResult.formatted || `${toolResult.expression} = ${toolResult.result}`;
          break;
          
        case "get_profile_data":
          if (toolCall.arguments.dataType === "about" && toolResult.data) {
            answer = toolResult.data;
          } else if (toolResult.data) {
            if (typeof toolResult.data === 'string') {
              answer = toolResult.data;
            } else {
              answer = `Here's information about ${toolCall.arguments.dataType.replace('_', ' ')}:`;
            }
          } else {
            answer = "I couldn't retrieve the profile information.";
          }
          break;
          
        case "get_current_time":
          answer = toolResult.message || `Current time: ${toolResult.readable || toolResult.timestamp}`;
          break;
          
        case "search_notes":
          if (toolResult.found === 0) {
            answer = "I couldn't find any relevant information in my personal notes.";
          } else {
            answer = `I found ${toolResult.found} relevant items:\n`;
            answer += toolResult.notes.map((n, i) => 
              `${i + 1}. ${n.content} (relevance: ${n.relevance})`
            ).join('\n');
          }
          break;
          
        case "send_email":
        case "send_email_template":
          if (toolResult.success) {
            answer = `✅ Email sent successfully to ${toolResult.to}!\nSubject: "${toolResult.subject}"\nMessage ID: ${toolResult.messageId}`;
          } else {
            answer = `❌ Failed to send email: ${toolResult.error}`;
            if (toolResult.suggestion) {
              answer += `\nSuggestion: ${toolResult.suggestion}`;
            }
          }
          break;
          
        case "validate_email":
          answer = toolResult.isValid ? 
            `✅ Email "${toolResult.email}" is valid.` : 
            `❌ Email "${toolResult.email}" is invalid. ${toolResult.suggestion}`;
          break;
          
        default:
          answer = `Operation completed using ${toolCall.name}.`;
      }
      
      return res.json({
        answer: answer,
        tool_used: true,
        tool_name: toolCall.name,
        tool_result: toolResult,
        success: !toolResult.error
      });
      
    } else {
      // No tool needed, use LLM response directly
      console.log("✅ No tool needed, using LLM response");
      return res.json({
        answer: llmResponse,
        tool_used: false
      });
    }

  } catch (error) {
    console.error("❌ Server error:", error);
    
    let userMessage = "Sorry, I encountered an error. ";
    if (error.message.includes("API key")) {
      userMessage += "Please check the API configuration.";
    } else if (error.message.includes("timeout")) {
      userMessage += "The request timed out. Please try again.";
    } else {
      userMessage += "Please try again.";
    }
    
    return res.status(500).json({ 
      answer: userMessage,
      error: error.message,
      tool_used: false,
      timestamp: new Date().toISOString()
    });
  }
});
// ========== ADDITIONAL ENDPOINTS ==========

// List all available tools
app.get("/tools", (req, res) => {
  const toolList = Object.values(serverTools).map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
  res.json({
    tools: toolList,
    count: toolList.length,
    timestamp: new Date().toISOString()
  });
});

// Test specific tool
app.post("/tools/:toolName/test", async (req, res) => {
  const { toolName } = req.params;
  const args = req.body;
  
  // Find tool by name
  const toolEntries = Object.entries(serverTools);
  const toolEntry = toolEntries.find(([_, toolObj]) => toolObj.name === toolName);
  
  if (!toolEntry) {
    return res.status(404).json({ 
      error: `Tool "${toolName}" not found`,
      available_tools: toolEntries.map(([_, t]) => t.name)
    });
  }
  
  const [_, tool] = toolEntry;
  
  try {
    const result = await tool.execute(args);
    res.json({ 
      success: true, 
      tool: toolName,
      result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      error: error.message,
      tool: toolName
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "Personal AI Assistant",
    version: "1.0.0"
  });
});

// Email configuration test
app.get("/email/config", (req, res) => {
  const config = {
    emailService: process.env.EMAIL_SERVICE || 'gmail',
    emailUser: process.env.EMAIL_USER ? `${process.env.EMAIL_USER.substring(0, 3)}...` : 'Missing',
    emailPassword: process.env.EMAIL_PASSWORD ? 'Set' : 'Missing',
    senderName: process.env.EMAIL_SENDER_NAME || 'Not set',
    configured: !!(process.env.EMAIL_USER && process.env.EMAIL_PASSWORD)
  };
  res.json(config);
});

// Send test email
app.post("/email/test", async (req, res) => {
  const { to = "test@example.com" } = req.body;
  
  if (!to) {
    return res.status(400).json({ error: "Recipient email is required" });
  }

  try {
    const result = await serverTools.sendEmail.execute({
      to: to,
      subject: "Test Email from Personal Assistant",
      body: `This is a test email sent at ${new Date().toLocaleString()}\n\nIf you received this, email configuration is working correctly!\n\nBest regards,\nYour Personal AI Assistant`,
      priority: "normal"
    });
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      suggestion: "Check your .env file for EMAIL_USER and EMAIL_PASSWORD"
    });
  }
});

// RAG statistics
app.get("/rag/stats", (req, res) => {
  try {
    const stats = getStats();
    res.json({
      ...stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Endpoint not found",
    available_endpoints: [
      "POST /ask - Main query endpoint",
      "GET /tools - List all tools",
      "GET /health - Health check",
      "GET /rag/stats - RAG statistics",
      "GET /email/config - Email configuration",
      "POST /email/test - Send test email"
    ]
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("\n" + "=".repeat(50));
  console.log("🚀 Personal AI Assistant Server");
  console.log("=".repeat(50));
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log("\n🛠️ Available Tools:");
  Object.values(serverTools).forEach(tool => {
    console.log(`  • ${tool.name.padEnd(20)} - ${tool.description}`);
  });
  console.log("\n💡 Test Queries:");
  console.log(`  • "Tell me about yourself"`);
  console.log(`  • "What are my skills?"`);
  console.log(`  • "23 + 4"`);
  console.log(`  • "Send email to test@example.com about meeting"`);
  console.log(`  • "What time is it?"`);
  console.log(`  • "Search for notes about projects"`);
  console.log("\n" + "=".repeat(50));
});