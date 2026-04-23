/**
 * Netlify build script — injects webhook URL env vars into supabase-config.js.
 *
 * Required Netlify environment variables:
 *   UPLOAD_WEBHOOK_URL      — e.g. https://your-n8n.example.com/webhook/upload
 *   CHAT_WEBHOOK_URL        — e.g. https://your-n8n.example.com/webhook/chat
 *   TRANSCRIPT_WEBHOOK_URL  — e.g. https://your-n8n.example.com/webhook/fetch
 */

const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "..", "supabase-config.js");

const replacements = {
  __UPLOAD_WEBHOOK_URL__: process.env.UPLOAD_WEBHOOK_URL || "",
  __CHAT_WEBHOOK_URL__: process.env.CHAT_WEBHOOK_URL || "",
  __TRANSCRIPT_WEBHOOK_URL__: process.env.TRANSCRIPT_WEBHOOK_URL || "",
};

let content = fs.readFileSync(CONFIG_FILE, "utf8");

let missing = [];
for (const [token, value] of Object.entries(replacements)) {
  if (!value) {
    missing.push(token);
  }
  content = content.split(token).join(value);
}

fs.writeFileSync(CONFIG_FILE, content, "utf8");

if (missing.length > 0) {
  console.warn(
    "[inject-env] WARNING: the following env vars were not set — " +
      "their webhook URLs will be empty in the deployed build:\n  " +
      missing.join("\n  ")
  );
} else {
  console.log("[inject-env] All webhook URLs injected successfully.");
}
