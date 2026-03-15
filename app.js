const appConfig = window.APP_CONFIG || {};
const isLocalHostForApp =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

function getConfiguredUrl(value, localFallback = "") {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (trimmed) {
    return trimmed;
  }

  return isLocalHostForApp ? localFallback : "";
}

const UPLOAD_WEBHOOK_URL = getConfiguredUrl(
  appConfig.uploadWebhookUrl,
  "http://localhost:5678/webhook/upload",
);
const UPLOAD_WEBHOOK_FALLBACK_URL = getConfiguredUrl(
  appConfig.uploadWebhookFallbackUrl,
  "",
);

const CHAT_WEBHOOK_URL = getConfiguredUrl(
  appConfig.chatWebhookUrl,
  "http://localhost:5678/webhook/chat",
);
const CHAT_WEBHOOK_FALLBACK_URL = getConfiguredUrl(
  appConfig.chatWebhookFallbackUrl,
  "",
);

const TRANSCRIPT_WEBHOOK_URL = getConfiguredUrl(
  appConfig.transcriptWebhookUrl,
  "http://localhost:5678/webhook/fetch",
);
const TRANSCRIPT_WEBHOOK_FALLBACK_URL = getConfiguredUrl(
  appConfig.transcriptWebhookFallbackUrl,
  "",
);

const ALLOWED_EXTENSIONS = ["txt", "pdf", "csv"];
const DUMMY_USER_ID = "userA1B2C3";
const FREE_UPLOAD_LIMIT = 3;
const FREE_TRANSCRIPT_LIMIT = 3;
const billingConfig = window.BILLING_CONFIG || {};
const BILLING_API_BASE = getConfiguredUrl(
  billingConfig.apiBaseUrl,
  "http://localhost:4242",
).replace(/\/+$/, "");
const BILLING_PRO_PRICE_ID = billingConfig.proPriceId || "";

function buildBillingApiUrl(path) {
  return BILLING_API_BASE ? `${BILLING_API_BASE}${path}` : path;
}

function getN8nWebhookCandidates(webhookUrl) {
  const trimmed = (webhookUrl || "").trim();
  if (!trimmed) {
    return [];
  }

  const candidates = [trimmed];

  // n8n often uses /webhook-test/* for test runs and /webhook/* for active runs.
  if (trimmed.includes("/webhook/")) {
    candidates.push(trimmed.replace("/webhook/", "/webhook-test/"));
  } else if (trimmed.includes("/webhook-test/")) {
    candidates.push(trimmed.replace("/webhook-test/", "/webhook/"));
  }

  return Array.from(new Set(candidates));
}

function getOrderedWebhookCandidates(primaryUrl, fallbackUrl = "") {
  const primaryCandidates = getN8nWebhookCandidates(primaryUrl);
  const fallbackCandidates = getN8nWebhookCandidates(fallbackUrl);
  return Array.from(new Set([...primaryCandidates, ...fallbackCandidates]));
}

function getTranscriptWebhookCandidates() {
  return getOrderedWebhookCandidates(
    TRANSCRIPT_WEBHOOK_URL,
    TRANSCRIPT_WEBHOOK_FALLBACK_URL,
  );
}

const form = document.getElementById("upload-form");
const fileInput = document.getElementById("file-input");
const selectedFile = document.getElementById("selected-file");
const submitButton = document.getElementById("submit-btn");
const statusEl = document.getElementById("status");
const dropzone = document.getElementById("dropzone");
const payloadPreview = document.getElementById("payload-preview");
const multipartKeysEl = document.getElementById("multipart-keys");
const copyPayloadButton = document.getElementById("copy-payload-btn");

const transcriptForm = document.getElementById("transcript-form");
const videoUrlInput = document.getElementById("video-url-input");
const transcriptSubmitButton = document.getElementById("transcript-submit");
const transcriptStatusEl = document.getElementById("transcript-status");
const transcriptOutputEl = document.getElementById("transcript-output");
const copyTranscriptButton = document.getElementById("copy-transcript-btn");
const historyListEl = document.getElementById("history-list");
const historyStatusEl = document.getElementById("history-status");
const refreshHistoryButton = document.getElementById("refresh-history-btn");

const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatMessages = document.getElementById("chat-messages");
const chatSubmit = document.getElementById("chat-submit");

const userNameEl = document.getElementById("user-name");
const tierBadgeEl = document.getElementById("tier-badge");
const tierUsageEl = document.getElementById("tier-usage");
const resetUsageButton = document.getElementById("reset-usage-btn");
const logoutButton = document.getElementById("logout-btn");

const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));
const upgradeModal = document.getElementById("upgrade-modal");
const upgradeModalClose = document.getElementById("upgrade-modal-close");
const upgradeBtn = document.getElementById("upgrade-btn");
const upgradeModalStatusEl = document.getElementById("upgrade-modal-status");

const METADATA_KEYS = [
  "userId",
  "filename",
  "size",
  "mimeType",
  "extension",
  "uploadedAt",
];
const MULTIPART_KEYS = ["file", ...METADATA_KEYS, "payloadJson"];

let supabaseClient = null;
let currentUser = null;
let currentAccessToken = "";
let usageState = {
  uploads: 0,
  transcripts: 0,
  plan: "free",
  locked: false,
};

const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(12)))
  .map((b) => b.toString(36).padStart(2, "0"))
  .join("")
  .replace(/[^a-z0-9]/g, "")
  .slice(0, 16)
  .toUpperCase();

function getFileExtension(fileName) {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function isAllowedFile(file) {
  return ALLOWED_EXTENSIONS.includes(getFileExtension(file.name));
}

function setStatus(message, type = "") {
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function setTranscriptStatus(message, type = "") {
  if (!transcriptStatusEl) {
    return;
  }
  transcriptStatusEl.textContent = message;
  transcriptStatusEl.className = `status ${type}`.trim();
}

function setTranscriptOutput(message) {
  if (!transcriptOutputEl) {
    return;
  }
  transcriptOutputEl.textContent = message;
}

function setHistoryStatus(message, type = "") {
  if (!historyStatusEl) {
    return;
  }

  historyStatusEl.textContent = message;
  historyStatusEl.className = `status ${type}`.trim();
}

function setActiveTab(tabName) {
  tabButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.tab === tabName);
  });

  tabPanels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.id === `tab-${tabName}`);
  });

  if (tabName === "history") {
    void loadTranscriptHistory();
  }
}

function getUsageStorageKey(userId) {
  return `docuchat-tier:${userId}`;
}

function isLimitReached(uploads, transcripts) {
  return uploads >= FREE_UPLOAD_LIMIT || transcripts >= FREE_TRANSCRIPT_LIMIT;
}

function deriveLockedState(plan, uploads, transcripts) {
  if (plan === "pro") {
    return false;
  }

  return isLimitReached(uploads, transcripts);
}

function usageLockMessage() {
  return "Free plan credits used up. Upgrade to Pro to continue using DocuChat AI.";
}

function loadUsageState(userId) {
  const fallback = {
    uploads: 0,
    transcripts: 0,
    plan: "free",
    locked: false,
  };

  try {
    const raw = localStorage.getItem(getUsageStorageKey(userId));
    if (!raw) {
      return fallback;
    }

    const parsed = JSON.parse(raw);
    const uploads = Number(parsed.uploads) || 0;
    const transcripts = Number(parsed.transcripts) || 0;
    const parsedPlan = parsed.plan || (parsed.tier === "pro" ? "pro" : "free");

    return {
      uploads,
      transcripts,
      plan: parsedPlan,
      locked: deriveLockedState(parsedPlan, uploads, transcripts),
    };
  } catch {
    return fallback;
  }
}

function persistUsageState(userId) {
  localStorage.setItem(getUsageStorageKey(userId), JSON.stringify(usageState));
}

function updateTierUI() {
  if (!tierBadgeEl || !tierUsageEl) {
    return;
  }

  const isPro = usageState.plan === "pro";
  tierBadgeEl.textContent = isPro ? "Pro" : "Free";
  tierBadgeEl.classList.toggle("tier-badge--pro", isPro);
  tierBadgeEl.classList.toggle("tier-badge--free", !isPro);

  const uploadDisplay = isPro
    ? `${usageState.uploads}/unlimited`
    : `${usageState.uploads}/${FREE_UPLOAD_LIMIT}`;
  const transcriptDisplay = isPro
    ? `${usageState.transcripts}/unlimited`
    : `${usageState.transcripts}/${FREE_TRANSCRIPT_LIMIT}`;

  const lockSuffix = usageState.locked ? " • Upgrade required" : "";
  tierUsageEl.textContent =
    `Uploads ${uploadDisplay} • Transcripts ${transcriptDisplay}` + lockSuffix;
}

function recomputeUsageLockState() {
  usageState.locked = deriveLockedState(
    usageState.plan,
    usageState.uploads,
    usageState.transcripts,
  );
}

function applyUsageLockUI() {
  if (submitButton) {
    submitButton.disabled = !fileInput?.files?.[0];
  }

  if (transcriptSubmitButton) {
    transcriptSubmitButton.disabled = false;
  }

  if (chatInput) {
    chatInput.disabled = false;
  }

  if (chatSubmit) {
    chatSubmit.disabled = false;
  }

  if (usageState.locked) {
    setStatus(usageLockMessage(), "error");
    setTranscriptStatus(usageLockMessage(), "error");
  }
}

function canUseAppFeatures() {
  return !usageState.locked;
}

function showUpgradeModal() {
  if (upgradeModal) {
    upgradeModal.setAttribute("aria-hidden", "false");
    upgradeModal.style.display = "flex";
    // Focus the upgrade button for keyboard navigation
    if (upgradeBtn) {
      upgradeBtn.focus();
    }
  }
}

function closeUpgradeModal() {
  if (upgradeModal) {
    upgradeModal.setAttribute("aria-hidden", "true");
    upgradeModal.style.display = "none";
  }
}

function setUpgradeModalStatus(message, type = "") {
  if (!upgradeModalStatusEl) {
    return;
  }

  upgradeModalStatusEl.textContent = message;
  upgradeModalStatusEl.className = `status upgrade-modal-status ${type}`.trim();
}

async function startUpgradeCheckout() {
  if (!currentUser) {
    setStatus("Session is not ready. Please sign in again.", "error");
    return;
  }

  if (!BILLING_PRO_PRICE_ID) {
    setStatus(
      "Billing is not configured yet. Add BILLING_CONFIG.proPriceId in supabase-config.js.",
      "error",
    );
    return;
  }

  if (!upgradeBtn) {
    return;
  }

  const originalText = upgradeBtn.textContent;
  upgradeBtn.disabled = true;
  upgradeBtn.textContent = "Redirecting...";
  setUpgradeModalStatus("Starting secure checkout...", "");

  try {
    const successUrl = `${window.location.origin}/index.html`;
    const cancelUrl = `${window.location.origin}/index.html`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);

    const response = await fetch(
      buildBillingApiUrl("/api/create-checkout-session"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          userId: currentUser.id,
          email: currentUser.email || "",
          priceId: BILLING_PRO_PRICE_ID,
          successUrl,
          cancelUrl,
        }),
      },
    );
    clearTimeout(timeoutId);

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not start checkout session.");
    }

    if (!data.url) {
      throw new Error("Checkout URL missing from billing API response.");
    }

    setUpgradeModalStatus("Redirecting to Stripe Checkout...", "success");
    window.location.assign(data.url);
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? "Billing API timed out. Make sure billing server is running on port 4242."
        : error.message;

    setStatus(`Upgrade failed: ${message}`, "error");
    setTranscriptStatus(`Upgrade failed: ${message}`, "error");
    setUpgradeModalStatus(`Upgrade failed: ${message}`, "error");
    console.error("Upgrade checkout error:", error);
    upgradeBtn.disabled = false;
    upgradeBtn.textContent = originalText;
  }
}

async function applyUpgradeFromReturnSession() {
  if (!currentUser) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const returnSessionId = params.get("session_id");
  if (!returnSessionId) {
    return;
  }

  try {
    const response = await fetch(
      buildBillingApiUrl("/api/verify-checkout-session"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: returnSessionId }),
      },
    );

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Unable to verify checkout session.");
    }

    if (!data.paid) {
      throw new Error("Payment is not completed yet.");
    }

    if (data.userId && data.userId !== currentUser.id) {
      throw new Error("Payment verification user mismatch.");
    }

    usageState.plan = "pro";
    usageState.locked = false;
    persistUsageState(currentUser.id);
    updateTierUI();
    applyUsageLockUI();
    closeUpgradeModal();
    setUpgradeModalStatus("", "");

    setStatus("Upgrade successful. Your Pro plan is now active.", "success");
    setTranscriptStatus(
      "Upgrade successful. Your Pro plan is now active.",
      "success",
    );
    if (data.persisted === false && data.warning) {
      appendMessage("system", `Plan persistence warning: ${data.warning}`);
      setStatus(
        `Upgrade succeeded, but persistence failed: ${data.warning}`,
        "error",
      );
    }
    appendMessage("system", "Upgrade successful. Pro plan enabled.");
  } catch (error) {
    setStatus(`Upgrade verification failed: ${error.message}`, "error");
  } finally {
    const cleanUrl = `${window.location.origin}/index.html`;
    window.history.replaceState({}, "", cleanUrl);
  }
}

async function syncUserPlanFromServer(accessToken) {
  if (!currentUser || !accessToken) {
    return;
  }

  try {
    const response = await fetch(buildBillingApiUrl("/api/get-user-plan"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: currentUser.id,
        accessToken,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "Could not fetch persisted plan.");
    }

    usageState.plan = data.plan === "pro" ? "pro" : "free";
    recomputeUsageLockState();
    updateTierUI();
    applyUsageLockUI();
    persistUsageState(currentUser.id);
  } catch (error) {
    appendMessage(
      "system",
      `Plan sync warning: ${error.message}. Continuing with local plan state.`,
    );
  }
}

async function getBillingAccessToken(forceRefresh = false) {
  if (!supabaseClient) {
    throw new Error("Supabase client is not ready.");
  }

  if (forceRefresh) {
    const refreshResult = await supabaseClient.auth.refreshSession();
    const refreshError = refreshResult.error;
    const refreshedSession = refreshResult.data?.session;

    if (refreshError || !refreshedSession?.access_token) {
      throw new Error("Could not refresh user session token.");
    }

    currentAccessToken = refreshedSession.access_token;
    return currentAccessToken;
  }

  const sessionResult = await supabaseClient.auth.getSession();
  const sessionError = sessionResult.error;
  const session = sessionResult.data?.session;

  if (sessionError || !session?.access_token) {
    throw new Error("Could not access user session token.");
  }

  currentAccessToken = session.access_token;
  return currentAccessToken;
}

async function postBillingJson(path, payload) {
  let accessToken = await getBillingAccessToken();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(buildBillingApiUrl(path), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "X-User-Id": currentUser.id,
      },
      body: JSON.stringify({
        ...payload,
        userId: currentUser.id,
        accessToken,
        user_id: currentUser.id,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      return data;
    }

    const errorMessage = data.error || "Billing request failed.";
    if (
      response.status === 401 &&
      errorMessage === "Invalid access token." &&
      attempt === 0
    ) {
      accessToken = await getBillingAccessToken(true);
      continue;
    }

    throw new Error(errorMessage);
  }

  throw new Error("Billing request failed after token refresh.");
}

async function appendTranscriptHistory(videoUrl, transcriptText) {
  if (!currentUser || !supabaseClient) {
    setTranscriptStatus(
      "Transcript ready, but history save was skipped because the session is not ready.",
      "error",
    );
    return;
  }

  try {
    if (!videoUrl || !videoUrl.trim()) {
      throw new Error("Video URL is empty for transcript history append.");
    }

    if (!transcriptText || !transcriptText.trim()) {
      throw new Error(
        "Transcript text is empty for transcript history append.",
      );
    }

    await postBillingJson("/api/append-transcript-history", {
      videoUrl,
      transcriptText,
      video_url: videoUrl,
      transcript: transcriptText,
    });
  } catch (error) {
    console.error("Transcript history append failed:", error);
    setTranscriptStatus(
      `Transcript ready, but history could not be saved: ${error.message}`,
      "error",
    );
  }
}

async function appendTranscriptFailure(
  videoUrl,
  failureReason,
  rawResponse = "",
) {
  if (!currentUser || !supabaseClient) {
    return;
  }

  try {
    await postBillingJson("/api/append-transcript-failure", {
      videoUrl,
      failureReason,
      rawResponse,
      video_url: videoUrl,
      failure_reason: failureReason,
      raw_response: rawResponse,
    });
  } catch (error) {
    console.error("Transcript failure append failed:", error);
  }
}

function incrementUsage(type) {
  if (!currentUser) {
    return false;
  }

  if (type === "uploads") {
    usageState.uploads += 1;
  }
  if (type === "transcripts") {
    usageState.transcripts += 1;
  }

  recomputeUsageLockState();
  updateTierUI();
  persistUsageState(currentUser.id);
  applyUsageLockUI();
  return true;
}

function extractYouTubeVideoUrl(rawUrl) {
  try {
    const url = new URL(rawUrl.trim());
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    let videoId = "";

    if (host === "youtu.be") {
      videoId = url.pathname.slice(1).split("/")[0];
    } else if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") {
        videoId = url.searchParams.get("v") || "";
      } else if (url.pathname.startsWith("/shorts/")) {
        videoId = url.pathname.split("/")[2] || "";
      } else if (url.pathname.startsWith("/embed/")) {
        videoId = url.pathname.split("/")[2] || "";
      }
    }

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return null;
    }

    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return null;
  }
}

function extractReplyText(parsedBody, fallbackText) {
  if (Array.isArray(parsedBody) && parsedBody.length > 0) {
    const first = parsedBody[0] || {};
    return (
      first.output ||
      first.reply ||
      first.message ||
      first.text ||
      first.transcript ||
      fallbackText
    );
  }

  if (parsedBody && typeof parsedBody === "object") {
    return (
      parsedBody.output ||
      parsedBody.reply ||
      parsedBody.message ||
      parsedBody.text ||
      parsedBody.transcript ||
      fallbackText
    );
  }

  return fallbackText;
}

function stripCodeFence(text) {
  if (typeof text !== "string") {
    return "";
  }

  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }

  return trimmed
    .replace(/^```[a-zA-Z0-9_-]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

function collectTextCandidates(node, candidates, depth = 0) {
  if (depth > 6 || node == null) {
    return;
  }

  if (typeof node === "string") {
    const normalized = stripCodeFence(node);
    if (normalized) {
      candidates.push(normalized);
    }
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectTextCandidates(item, candidates, depth + 1));
    return;
  }

  if (typeof node === "object") {
    const preferredKeys = [
      "transcript",
      "pageContent",
      "output",
      "text",
      "content",
      "message",
      "result",
      "answer",
      "summary",
      "body",
      "data",
    ];

    preferredKeys.forEach((key) => {
      if (key in node) {
        collectTextCandidates(node[key], candidates, depth + 1);
      }
    });

    Object.values(node).forEach((value) => {
      collectTextCandidates(value, candidates, depth + 1);
    });
  }
}

function cleanTranscriptCandidate(text) {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) {
    return "";
  }

  const cleaned = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => !isNoiseTranscriptLine(line))
    .join("\n")
    .trim();

  return cleaned;
}

function pickFirstValue(record, keys) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function parseJsonIfPossible(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getHostFromUrl(urlString) {
  try {
    return new URL(urlString).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getVideoUrlFromHistoryRow(row) {
  const direct = pickFirstValue(row, [
    "videoUrl",
    "video_url",
    "url",
    "video",
    "source_url",
    "youtube_url",
  ]);
  if (direct) {
    return direct;
  }

  const nestedMeta = row.metadata;
  if (nestedMeta && typeof nestedMeta === "object") {
    const fromMeta = pickFirstValue(nestedMeta, [
      "videoUrl",
      "video_url",
      "url",
    ]);
    if (fromMeta) {
      return fromMeta;
    }
  }

  const parsedPayload = parseJsonIfPossible(
    pickFirstValue(row, ["payloadJson", "payload_json"]),
  );
  if (parsedPayload) {
    const fromPayload = pickFirstValue(parsedPayload, [
      "videoUrl",
      "video_url",
      "url",
    ]);
    if (fromPayload) {
      return fromPayload;
    }
  }

  return "";
}

function getTranscriptSnippetFromHistoryRow(row) {
  const direct = pickFirstValue(row, [
    "transcript",
    "output",
    "text",
    "content",
    "pageContent",
  ]);
  if (direct) {
    return normalizeTranscriptText(direct).slice(0, 220);
  }

  return "Transcript available";
}

function getVideoTitleFromHistoryRow(row, videoUrl) {
  const direct = pickFirstValue(row, [
    "video_title",
    "videoTitle",
    "title",
    "name",
    "video_name",
  ]);
  if (direct) {
    return direct;
  }

  const nestedMeta = row.metadata;
  if (nestedMeta && typeof nestedMeta === "object") {
    const fromMeta = pickFirstValue(nestedMeta, [
      "video_title",
      "videoTitle",
      "title",
      "name",
    ]);
    if (fromMeta) {
      return fromMeta;
    }
  }

  const parsedPayload = parseJsonIfPossible(
    pickFirstValue(row, ["payloadJson", "payload_json"]),
  );
  if (parsedPayload) {
    const fromPayload = pickFirstValue(parsedPayload, [
      "video_title",
      "videoTitle",
      "title",
      "name",
    ]);
    if (fromPayload) {
      return fromPayload;
    }
  }

  const host = getHostFromUrl(videoUrl);
  return host ? `Video from ${host}` : "Video transcript";
}

function getHistoryDateText(row) {
  const raw = pickFirstValue(row, [
    "created_at",
    "createdAt",
    "inserted_at",
    "timestamp",
  ]);
  if (!raw) {
    return "Unknown date";
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return date.toLocaleString();
}

function getHistoryFaceIconUrl(videoUrl) {
  function getYoutubeVideoId(urlString) {
    try {
      const url = new URL(urlString);
      const host = url.hostname.replace(/^www\./, "").toLowerCase();

      if (host === "youtu.be") {
        return url.pathname.slice(1).split("/")[0] || "";
      }

      if (host === "youtube.com" || host === "m.youtube.com") {
        if (url.pathname === "/watch") {
          return url.searchParams.get("v") || "";
        }
        if (
          url.pathname.startsWith("/shorts/") ||
          url.pathname.startsWith("/embed/")
        ) {
          return url.pathname.split("/")[2] || "";
        }
      }
    } catch {
      return "";
    }

    return "";
  }

  try {
    const host = getHostFromUrl(videoUrl);
    const videoId = getYoutubeVideoId(videoUrl);

    if (/youtube\.com$|youtu\.be$/i.test(host) && videoId) {
      return `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
    }

    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  } catch {
    return "https://www.google.com/s2/favicons?domain=youtube.com&sz=64";
  }
}

function getHistoryTitle(videoUrl) {
  if (!videoUrl) {
    return "Video transcript";
  }

  try {
    const host = new URL(videoUrl).hostname.replace(/^www\./, "");
    return `Transcript from ${host}`;
  } catch {
    return "Video transcript";
  }
}

function renderHistoryList(rows) {
  if (!historyListEl) {
    return;
  }

  if (!rows.length) {
    historyListEl.innerHTML =
      '<p class="history-meta">No transcripts found yet.</p>';
    return;
  }

  const html = rows
    .map((row) => {
      const videoUrl = getVideoUrlFromHistoryRow(row);
      const snippet = getTranscriptSnippetFromHistoryRow(row);
      const createdText = getHistoryDateText(row);
      const sourceTitle = getHistoryTitle(videoUrl);
      const videoTitle = getVideoTitleFromHistoryRow(row, videoUrl);
      const faceUrl = getHistoryFaceIconUrl(videoUrl);
      const host = getHostFromUrl(videoUrl);
      const faceFallbackUrl = videoUrl
        ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host || "youtube.com")}&sz=64`
        : "https://www.google.com/s2/favicons?domain=youtube.com&sz=64";
      const safeLink = videoUrl || "#";
      const linkAttrs = videoUrl
        ? 'target="_blank" rel="noopener noreferrer"'
        : 'aria-disabled="true"';
      const safeVideoTitle = escapeHtml(videoTitle);
      const safeSourceTitle = escapeHtml(sourceTitle);
      const safeSnippet = escapeHtml(snippet);
      const safeCreatedText = escapeHtml(createdText);
      const safeHost = escapeHtml(host || "Unknown source");

      return `
        <article class="history-card">
          <a class="history-face-link" href="${safeLink}" ${linkAttrs}>
            <img class="history-face" src="${faceUrl}" data-fallback-face="${faceFallbackUrl}" alt="Video thumbnail" loading="lazy" />
          </a>
          <div>
            <p class="history-title"><a class="history-link" href="${safeLink}" ${linkAttrs}>${safeVideoTitle}</a></p>
            <p class="history-meta">${safeCreatedText} • ${safeHost}</p>
            <p class="history-snippet">${safeSnippet}</p>
            <p class="history-meta"><a class="history-link" href="${safeLink}" ${linkAttrs}>${safeSourceTitle}</a></p>
          </div>
        </article>
      `;
    })
    .join("");

  historyListEl.innerHTML = html;

  historyListEl
    .querySelectorAll(".history-face[data-fallback-face]")
    .forEach((img) => {
      img.addEventListener(
        "error",
        () => {
          const fallbackSrc = img.getAttribute("data-fallback-face");
          if (fallbackSrc && img.src !== fallbackSrc) {
            img.src = fallbackSrc;
          }
        },
        { once: true },
      );
    });
}

async function loadTranscriptHistory() {
  if (!supabaseClient || !currentUser) {
    return;
  }

  setHistoryStatus("Loading history...");

  try {
    const data = await postBillingJson("/api/get-transcript-history", {
      limit: 200,
    });

    if (Array.isArray(data.rows)) {
      renderHistoryList(data.rows);
      setHistoryStatus(
        `History loaded: ${data.rows.length} item(s).`,
        "success",
      );
      return;
    }
  } catch (error) {
    console.warn(
      "History API unavailable, using direct database query.",
      error,
    );
  }

  let data = null;
  let error = null;

  const historyTableAttempts = [
    () =>
      supabaseClient
        .from("transcript_history")
        .select("*")
        .eq("user_id", currentUser.id)
        .order("created_at", { ascending: false }),
    () =>
      supabaseClient
        .from("transcript_history")
        .select("*")
        .order("created_at", { ascending: false }),
    () => supabaseClient.from("transcript_history").select("*"),
  ];

  for (const attempt of historyTableAttempts) {
    const result = await attempt();
    data = result.data;
    error = result.error;
    if (!error) {
      break;
    }
  }

  if (error) {
    setHistoryStatus(`History could not be loaded: ${error.message}`, "error");
    renderHistoryList([]);
    return;
  }

  const rows = Array.isArray(data) ? data : [];
  const filteredRows = rows.filter((row) => {
    if (!row || typeof row !== "object") {
      return false;
    }

    // Keep row if user field matches or if no obvious user field exists.
    if (row.user_id || row.userId) {
      return row.user_id === currentUser.id || row.userId === currentUser.id;
    }

    return true;
  });

  renderHistoryList(filteredRows);
  setHistoryStatus(
    `History loaded: ${filteredRows.length} item(s).`,
    "success",
  );
}

function isNoiseTranscriptLine(line) {
  if (!line) {
    return true;
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  // UUID-like IDs commonly returned by workflow internals.
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed,
    )
  ) {
    return true;
  }

  // Raw URLs are not transcript text.
  if (/^https?:\/\//i.test(trimmed)) {
    return true;
  }

  // Strip lines that are exactly the current user ID.
  if (currentUser && trimmed === currentUser.id) {
    return true;
  }

  return false;
}

function extractTranscriptText(parsedBody, fallbackText) {
  if (Array.isArray(parsedBody)) {
    const pageContentLines = parsedBody
      .map((item) => {
        if (!item || typeof item !== "object") {
          return "";
        }

        if (typeof item.pageContent === "string") {
          return item.pageContent;
        }

        if (typeof item.output === "string") {
          return item.output;
        }

        if (typeof item.transcript === "string") {
          return item.transcript;
        }

        if (typeof item.text === "string") {
          return item.text;
        }

        return "";
      })
      .map((line) => line.trim())
      .filter((line) => !isNoiseTranscriptLine(line));

    if (pageContentLines.length > 0) {
      return pageContentLines.join("\n");
    }
  }

  const candidates = [];
  collectTextCandidates(parsedBody, candidates);

  const cleanedCandidates = candidates
    .map((candidate) => cleanTranscriptCandidate(candidate))
    .filter(Boolean);

  if (cleanedCandidates.length > 0) {
    return cleanedCandidates.sort((a, b) => b.length - a.length)[0];
  }

  return extractReplyText(parsedBody, fallbackText);
}

function parseTranscriptFromResponseText(responseText) {
  let transcriptText = responseText;

  try {
    const parsed = JSON.parse(responseText);
    transcriptText = extractTranscriptText(parsed, responseText);
  } catch {
    const codeFencePayload = stripCodeFence(responseText);
    const parsedFromCodeFence = parseJsonIfPossible(codeFencePayload);
    if (parsedFromCodeFence) {
      transcriptText = extractTranscriptText(
        parsedFromCodeFence,
        codeFencePayload,
      );
    }
  }

  const normalizedTranscriptText = normalizeTranscriptText(transcriptText);
  return normalizedTranscriptText || (responseText || "").trim();
}

function normalizeTranscriptText(text) {
  if (!text || typeof text !== "string") {
    return "";
  }

  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

function appendMessage(role, text) {
  if (!chatMessages) {
    return;
  }

  const bubble = document.createElement("div");
  bubble.className = `chat-bubble chat-bubble--${role}`;

  const content = document.createElement("p");
  content.className = "chat-bubble-text";
  content.textContent = text;

  bubble.appendChild(content);
  chatMessages.appendChild(bubble);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function setChatInputBusy(busy) {
  if (!chatInput || !chatSubmit) {
    return;
  }

  chatInput.disabled = busy;
  chatSubmit.disabled = busy;
  chatSubmit.textContent = busy ? "..." : "Send";
}

function setUserName(user) {
  if (!userNameEl) {
    return;
  }

  if (!user) {
    userNameEl.textContent = "unknown";
    return;
  }

  const metadata = user.user_metadata || {};
  const preferredName =
    metadata.full_name ||
    metadata.name ||
    metadata.display_name ||
    (user.email ? user.email.split("@")[0] : "user");

  userNameEl.textContent = preferredName;
}

async function initializeSession() {
  setUserName(null);

  const config = window.SUPABASE_CONFIG;
  const createClient = window.supabase && window.supabase.createClient;

  if (!createClient || !config || !config.url || !config.anonKey) {
    setStatus(
      "Supabase is not configured. Update supabase-config.js before using DocuChat AI.",
      "error",
    );
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
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Session check timed out.")), 8000);
      }),
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
    currentAccessToken = session.access_token || "";
    setUserName(currentUser);

    usageState = loadUsageState(currentUser.id);
    recomputeUsageLockState();
    updateTierUI();
    applyUsageLockUI();
    await syncUserPlanFromServer(session.access_token || "");
    await applyUpgradeFromReturnSession();

    appendMessage("system", `Session ready. ID: ${sessionId}`);
  } catch (error) {
    setStatus(`Could not load session: ${error.message}`, "error");
    appendMessage("system", `Could not load session: ${error.message}`);
  }
}

function createMetadataPayload(file) {
  return {
    userId: currentUser ? currentUser.id : DUMMY_USER_ID,
    filename: file.name,
    size: file.size,
    mimeType: file.type || "application/octet-stream",
    extension: getFileExtension(file.name),
    uploadedAt: new Date().toISOString(),
  };
}

function renderPayloadPreview(file) {
  if (!multipartKeysEl || !payloadPreview) {
    return;
  }

  if (!file) {
    multipartKeysEl.textContent = `Multipart keys: ${MULTIPART_KEYS.join(", ")}`;
    payloadPreview.textContent = "Select a file to preview metadata payload.";
    return;
  }

  const metadata = createMetadataPayload(file);
  multipartKeysEl.textContent = `Multipart keys: ${MULTIPART_KEYS.join(", ")}`;
  payloadPreview.textContent = JSON.stringify(metadata, null, 2);
}

function setSelectedFile(file) {
  if (!selectedFile || !submitButton) {
    return;
  }

  if (!file) {
    selectedFile.textContent = "No file selected";
    submitButton.disabled = true;
    renderPayloadPreview(null);
    return;
  }

  selectedFile.textContent = `Selected: ${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)`;
  submitButton.disabled = false;
  renderPayloadPreview(file);
}

function handleFileSelection(file) {
  if (!file) {
    setSelectedFile(null);
    setStatus("");
    return;
  }

  if (!isAllowedFile(file)) {
    fileInput.value = "";
    setSelectedFile(null);
    setStatus(
      "Invalid file type. Please upload a .txt, .pdf, or .csv file.",
      "error",
    );
    return;
  }

  const transfer = new DataTransfer();
  transfer.items.add(file);
  fileInput.files = transfer.files;

  setSelectedFile(file);
  setStatus("");
}

function initializeTabs() {
  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.tab);
    });
  });
}

function initializeUploadFeature() {
  fileInput.addEventListener("change", () => {
    handleFileSelection(fileInput.files[0]);
  });

  ["dragenter", "dragover"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((eventName) => {
    dropzone.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      dropzone.classList.remove("drag-over");
    });
  });

  dropzone.addEventListener("drop", (event) => {
    const [droppedFile] = event.dataTransfer.files;
    handleFileSelection(droppedFile);
  });

  copyPayloadButton.addEventListener("click", async () => {
    const file = fileInput.files[0];
    if (!file) {
      setStatus("Select a file before copying payload JSON.", "error");
      return;
    }

    const metadata = createMetadataPayload(file);
    const payloadText = JSON.stringify(metadata, null, 2);

    try {
      await navigator.clipboard.writeText(payloadText);
      setStatus("Payload JSON copied to clipboard.", "success");
    } catch {
      setStatus(
        "Could not copy payload JSON in this browser context.",
        "error",
      );
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!canUseAppFeatures()) {
      showUpgradeModal();
      return;
    }

    const file = fileInput.files[0];
    if (!file) {
      setStatus("Select a file before uploading.", "error");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Uploading...";
    setStatus("Sending file to n8n webhook...");

    try {
      if (!UPLOAD_WEBHOOK_URL) {
        throw new Error(
          "Upload webhook is not configured. Set APP_CONFIG.uploadWebhookUrl in supabase-config.js.",
        );
      }

      const metadata = createMetadataPayload(file);
      const createUploadFormData = () => {
        const payloadJson = JSON.stringify(metadata);
        const formData = new FormData();
        formData.append("file", file, file.name);
        formData.append("userId", metadata.userId);
        formData.append("filename", metadata.filename);
        formData.append("size", String(metadata.size));
        formData.append("mimeType", metadata.mimeType);
        formData.append("extension", metadata.extension);
        formData.append("uploadedAt", metadata.uploadedAt);
        formData.append("payloadJson", payloadJson);
        return formData;
      };

      const candidates = getOrderedWebhookCandidates(
        UPLOAD_WEBHOOK_URL,
        UPLOAD_WEBHOOK_FALLBACK_URL,
      );
      if (candidates.length === 0) {
        throw new Error(
          "Upload webhook is not configured. Set APP_CONFIG.uploadWebhookUrl in supabase-config.js.",
        );
      }

      let uploaded = false;
      let lastError = null;

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "POST",
            body: createUploadFormData(),
          });

          const responseText = await response.text();
          if (!response.ok) {
            throw new Error(
              responseText || `Upload failed with status ${response.status}`,
            );
          }

          uploaded = true;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!uploaded) {
        throw lastError || new Error("Upload request failed.");
      }

      incrementUsage("uploads");
      setStatus("Upload successful. File was sent to n8n.", "success");
    } catch (error) {
      setStatus(`Upload failed: ${error.message}`, "error");
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Upload to n8n";
    }
  });
}

function initializeTranscriptFeature() {
  transcriptForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!canUseAppFeatures()) {
      showUpgradeModal();
      return;
    }

    const rawUrl = videoUrlInput.value;
    const normalizedVideoUrl = extractYouTubeVideoUrl(rawUrl);

    if (!normalizedVideoUrl) {
      setTranscriptStatus("Please enter a valid YouTube video URL.", "error");
      return;
    }

    if (!currentUser) {
      setTranscriptStatus(
        "User session is not ready yet. Please wait and retry.",
        "error",
      );
      return;
    }

    transcriptSubmitButton.disabled = true;
    transcriptSubmitButton.textContent = "Extracting...";
    setTranscriptStatus("Fetching transcript...");

    try {
      const payload = {
        userId: currentUser.id,
        user_id: currentUser.id,
        email: currentUser.email || "",
        videoUrl: normalizedVideoUrl,
        video_url: normalizedVideoUrl,
        url: normalizedVideoUrl,
      };

      const fetchTranscriptResponse = async () => {
        const candidates = getTranscriptWebhookCandidates();
        let lastError = null;

        if (candidates.length === 0) {
          throw new Error(
            "Transcript webhook is not configured. Set APP_CONFIG.transcriptWebhookUrl in supabase-config.js.",
          );
        }

        for (const url of candidates) {
          try {
            const response = await fetch(url, {
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

            return { responseText, url };
          } catch (error) {
            lastError = error;
          }
        }

        throw lastError || new Error("Transcript webhook request failed.");
      };

      let { responseText, url: responseUrl } = await fetchTranscriptResponse();
      let transcriptText = parseTranscriptFromResponseText(responseText);

      if (!transcriptText) {
        setTranscriptStatus(
          "No transcript text returned. Retrying once...",
          "error",
        );
        const retryResult = await fetchTranscriptResponse();
        responseText = retryResult.responseText;
        responseUrl = retryResult.url;
        transcriptText = parseTranscriptFromResponseText(responseText);
      }

      if (!transcriptText) {
        const emptyTranscriptMessage =
          "Transcript was processed, but the webhook returned no transcript text.";
        transcriptText = emptyTranscriptMessage;
        setTranscriptStatus(
          `Transcript request completed, but no transcript text was returned by ${responseUrl}.`,
          "error",
        );
        setTranscriptOutput(transcriptText);
        appendMessage(
          "system",
          `Transcript webhook returned empty text from ${responseUrl}.`,
        );
        await appendTranscriptFailure(
          normalizedVideoUrl,
          emptyTranscriptMessage,
          responseText,
        );
        return;
      } else {
        setTranscriptStatus("Transcript ready.", "success");
      }

      setTranscriptOutput(transcriptText);
      incrementUsage("transcripts");
      await appendTranscriptHistory(normalizedVideoUrl, transcriptText);
      void loadTranscriptHistory();
    } catch (error) {
      await appendTranscriptFailure(
        normalizedVideoUrl || rawUrl || "unknown-video-url",
        error.message,
        "",
      );
      setTranscriptStatus(
        `Transcript request failed: ${error.message}`,
        "error",
      );
    } finally {
      transcriptSubmitButton.disabled = false;
      transcriptSubmitButton.textContent = "Extract Transcript";
    }
  });

  copyTranscriptButton.addEventListener("click", async () => {
    const transcriptText = transcriptOutputEl.textContent.trim();

    if (
      !transcriptText ||
      transcriptText === "Transcript output will appear here."
    ) {
      setTranscriptStatus("No transcript to copy yet.", "error");
      return;
    }

    try {
      await navigator.clipboard.writeText(transcriptText);
      setTranscriptStatus("Transcript copied to clipboard.", "success");
    } catch {
      setTranscriptStatus(
        "Could not copy transcript in this browser context.",
        "error",
      );
    }
  });
}

function initializeChatFeature() {
  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!canUseAppFeatures()) {
      showUpgradeModal();
      return;
    }

    const userMessage = chatInput.value.trim();
    if (!userMessage) {
      return;
    }

    appendMessage("user", userMessage);
    chatInput.value = "";
    setChatInputBusy(true);

    try {
      if (!CHAT_WEBHOOK_URL) {
        throw new Error(
          "Chat webhook is not configured. Set APP_CONFIG.chatWebhookUrl in supabase-config.js.",
        );
      }

      const payload = {
        chatInput: userMessage,
        sessionId,
        userId: currentUser ? currentUser.id : DUMMY_USER_ID,
      };

      const candidates = getOrderedWebhookCandidates(
        CHAT_WEBHOOK_URL,
        CHAT_WEBHOOK_FALLBACK_URL,
      );
      if (candidates.length === 0) {
        throw new Error(
          "Chat webhook is not configured. Set APP_CONFIG.chatWebhookUrl in supabase-config.js.",
        );
      }

      let responseText = "";
      let lastError = null;
      let completed = false;

      for (const url of candidates) {
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          responseText = await response.text();
          if (!response.ok) {
            throw new Error(
              responseText || `Request failed with status ${response.status}`,
            );
          }

          completed = true;
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!completed) {
        throw lastError || new Error("Chat request failed.");
      }

      let reply = responseText;
      try {
        const parsed = JSON.parse(responseText);
        reply = extractReplyText(parsed, responseText);
      } catch {
        // Not JSON.
      }

      appendMessage("assistant", reply);
    } catch (error) {
      appendMessage("system", `Error: ${error.message}`);
    } finally {
      setChatInputBusy(false);
      chatInput.focus();
    }
  });
}

function initializeLogout() {
  logoutButton.addEventListener("click", async () => {
    if (!supabaseClient) {
      window.location.href = "login.html";
      return;
    }

    await supabaseClient.auth.signOut();
    window.location.href = "login.html";
  });
}

function initializeUpgradeModal() {
  if (!upgradeModal) {
    return;
  }

  // Close button click
  if (upgradeModalClose) {
    upgradeModalClose.addEventListener("click", closeUpgradeModal);
  }

  // Overlay click (close modal when clicking outside)
  const overlay = upgradeModal.querySelector(".upgrade-modal-overlay");
  if (overlay) {
    overlay.addEventListener("click", closeUpgradeModal);
  }

  // ESC key to close
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "Escape" &&
      upgradeModal.getAttribute("aria-hidden") === "false"
    ) {
      closeUpgradeModal();
    }
  });

  if (upgradeBtn) {
    upgradeBtn.addEventListener("click", () => {
      void startUpgradeCheckout();
    });
  }

  setUpgradeModalStatus("", "");
}

function initializeDevControls() {
  if (!resetUsageButton) {
    return;
  }

  resetUsageButton.addEventListener("click", () => {
    if (!currentUser) {
      setStatus("User session is not ready yet.", "error");
      return;
    }

    usageState = {
      uploads: 0,
      transcripts: 0,
      plan: "free",
      locked: false,
    };

    recomputeUsageLockState();
    persistUsageState(currentUser.id);
    updateTierUI();
    applyUsageLockUI();
    setStatus("Usage counters reset for current user.", "success");
    setTranscriptStatus("Usage counters reset for current user.", "success");
    appendMessage("system", "Dev action: usage counters reset.");
  });
}

function initializeHistoryFeature() {
  if (!refreshHistoryButton) {
    return;
  }

  refreshHistoryButton.addEventListener("click", () => {
    void loadTranscriptHistory();
  });
}

function initializePage() {
  initializeTabs();
  initializeUploadFeature();
  initializeTranscriptFeature();
  initializeChatFeature();
  initializeHistoryFeature();
  initializeLogout();
  initializeUpgradeModal();
  initializeDevControls();
  initializeSession();
}

initializePage();
