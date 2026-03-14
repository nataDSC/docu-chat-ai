const appConfig = window.APP_CONFIG || {};
const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";
const CHAT_WEBHOOK_URL = (() => {
  const configuredUrl =
    typeof appConfig.chatWebhookUrl === "string"
      ? appConfig.chatWebhookUrl.trim()
      : "";

  if (configuredUrl) {
    return configuredUrl;
  }

  return isLocalHost ? "http://localhost:5678/webhook/chat" : "";
})();
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");
const chatSubmit = document.getElementById("chat-submit");
const userNameEl = document.getElementById("user-name");
const logoutButton = document.getElementById("logout-btn");

let supabaseClient = null;
let currentUser = null;

// Unique session ID generated once per page load.
const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
  .map((b) => b.toString(36).padStart(2, "0"))
  .join("")
  .replace(/[^a-z0-9]/g, "")
  .slice(0, 16)
  .toUpperCase();

// ── Session / Auth ─────────────────────────────────────────────────────────

async function initializeSession() {
  const config = window.SUPABASE_CONFIG;
  const createClient = window.supabase && window.supabase.createClient;

  if (!createClient || !config || !config.url || !config.anonKey) {
    appendMessage(
      "system",
      "Supabase is not configured. Update supabase-config.js.",
    );
    return;
  }

  try {
    supabaseClient = createClient(config.url, config.anonKey);

    const sessionResult = await Promise.race([
      supabaseClient.auth.getSession(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Session check timed out.")), 8000),
      ),
    ]);

    const {
      data: { session },
      error,
    } = sessionResult;

    if (error || !session || !session.user) {
      window.location.href = "login.html";
      return;
    }

    currentUser = session.user;
    const meta = currentUser.user_metadata || {};
    const displayName =
      meta.full_name ||
      meta.name ||
      meta.display_name ||
      (currentUser.email ? currentUser.email.split("@")[0] : "user");

    userNameEl.textContent = displayName;
    appendMessage("system", `Session started. Your session ID: ${sessionId}`);
  } catch (err) {
    appendMessage("system", `Could not load session: ${err.message}`);
  }
}

logoutButton.addEventListener("click", async () => {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  window.location.href = "login.html";
});

// ── UI helpers ─────────────────────────────────────────────────────────────

function appendMessage(role, text) {
  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble--${role}`;

  const content = document.createElement("p");
  content.className = "chat-bubble-text";
  content.textContent = text;

  bubble.appendChild(content);
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setInputBusy(busy) {
  chatInput.disabled = busy;
  chatSubmit.disabled = busy;
  chatSubmit.textContent = busy ? "…" : "Send";
}

function extractReplyText(parsedBody, fallbackText) {
  if (Array.isArray(parsedBody) && parsedBody.length > 0) {
    const first = parsedBody[0] || {};
    return (
      first.output || first.reply || first.message || first.text || fallbackText
    );
  }

  if (parsedBody && typeof parsedBody === "object") {
    return (
      parsedBody.output ||
      parsedBody.reply ||
      parsedBody.message ||
      parsedBody.text ||
      fallbackText
    );
  }

  return fallbackText;
}

// ── Chat ───────────────────────────────────────────────────────────────────

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const userMessage = chatInput.value.trim();
  if (!userMessage) {
    return;
  }

  appendMessage("user", userMessage);
  chatInput.value = "";
  setInputBusy(true);

  try {
    if (!CHAT_WEBHOOK_URL) {
      throw new Error(
        "Chat webhook is not configured. Set APP_CONFIG.chatWebhookUrl in supabase-config.js.",
      );
    }

    const payload = {
      chatInput: userMessage,
      sessionId,
      userId: currentUser ? currentUser.id : "anonymous",
    };

    const response = await fetch(CHAT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        responseText || `Request failed with status ${response.status}`,
      );
    }

    // Parse both object and array-shaped webhook responses.
    let reply = responseText;
    try {
      const parsed = JSON.parse(responseText);
      reply = extractReplyText(parsed, responseText);
    } catch {
      // Not JSON — use raw text as-is.
    }

    appendMessage("assistant", reply);
  } catch (err) {
    appendMessage("system", `Error: ${err.message}`);
  } finally {
    setInputBusy(false);
    chatInput.focus();
  }
});

initializeSession();
