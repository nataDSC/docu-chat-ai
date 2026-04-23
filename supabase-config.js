const SUPABASE_ENVIRONMENTS = {
  local: {
    url: "http://127.0.0.1:54321",
    anonKey: "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH",
  },
  cloud: {
    // Add your real cloud project values.
    url: "https://tjyubigahgmkfwfahyht.supabase.co",
    anonKey: "sb_publishable_nksoel3peQXcN19rlgadgA_iD4YUp5i",
  },
};

// Change only this value to switch environments: "local" or "cloud".
const activeEnvironment = "cloud";

const selectedConfig =
  SUPABASE_ENVIRONMENTS[activeEnvironment] || SUPABASE_ENVIRONMENTS.local;

const isLocalHost =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1";

const APP_ENVIRONMENTS = {
  local: {
    uploadWebhookUrl: "http://localhost:5678/webhook/upload",
    chatWebhookUrl: "http://localhost:5678/webhook/chat",
    transcriptWebhookUrl: "http://localhost:5678/webhook/fetch",
    transcriptEnabled: true,
    billingApiBaseUrl: "http://localhost:4242",
  },
  deployed: {
    // Values are injected at build time from Netlify env vars via scripts/inject-env.js.
    // Locally, set UPLOAD_WEBHOOK_URL / CHAT_WEBHOOK_URL / TRANSCRIPT_WEBHOOK_URL or
    // edit the placeholder strings below directly (they are replaced before deploy).
    uploadWebhookUrl: "__UPLOAD_WEBHOOK_URL__",
    chatWebhookUrl: "__CHAT_WEBHOOK_URL__",
    transcriptWebhookUrl: "__TRANSCRIPT_WEBHOOK_URL__",
    transcriptEnabled: true,
    // Optional tunnel fallback URLs (e.g., ngrok/cloudflared). Leave empty to disable.
    uploadWebhookFallbackUrl: "",
    chatWebhookFallbackUrl: "",
    transcriptWebhookFallbackUrl: "",
    // Empty string means use same-origin Netlify Functions at /api/*.
    billingApiBaseUrl: "",
  },
};

const activeAppEnvironment = isLocalHost ? "local" : "deployed";
const selectedAppConfig =
  APP_ENVIRONMENTS[activeAppEnvironment] || APP_ENVIRONMENTS.local;

window.SUPABASE_CONFIG = {
  environment: activeEnvironment,
  url: selectedConfig.url,
  anonKey: selectedConfig.anonKey,
  redirectTo: window.location.origin + "/index.html",
};

window.APP_CONFIG = {
  environment: activeAppEnvironment,
  uploadWebhookUrl: selectedAppConfig.uploadWebhookUrl,
  chatWebhookUrl: selectedAppConfig.chatWebhookUrl,
  transcriptWebhookUrl: selectedAppConfig.transcriptWebhookUrl,
  transcriptEnabled: selectedAppConfig.transcriptEnabled,
  uploadWebhookFallbackUrl: selectedAppConfig.uploadWebhookFallbackUrl,
  chatWebhookFallbackUrl: selectedAppConfig.chatWebhookFallbackUrl,
  transcriptWebhookFallbackUrl: selectedAppConfig.transcriptWebhookFallbackUrl,
};

window.BILLING_CONFIG = {
  apiBaseUrl: selectedAppConfig.billingApiBaseUrl,
  // Replace with your Stripe Price ID (e.g. price_12345)
  proPriceId: "price_1TAHDjDZbnbwJQ2NV514d3l0",
};
