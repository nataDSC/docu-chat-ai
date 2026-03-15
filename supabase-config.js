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
    billingApiBaseUrl: "http://localhost:4242",
  },
  deployed: {
    // Replace these with your public n8n webhook URLs before deploying.
    uploadWebhookUrl:
      "https://80dc-47-150-34-171.ngrok-free.app/webhook/upload",
    chatWebhookUrl: "https://80dc-47-150-34-171.ngrok-free.app/webhook/chat",
    transcriptWebhookUrl:
      "https://80dc-47-150-34-171.ngrok-free.app/webhook/fetch",
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
};

window.BILLING_CONFIG = {
  apiBaseUrl: selectedAppConfig.billingApiBaseUrl,
  // Replace with your Stripe Price ID (e.g. price_12345)
  proPriceId: "price_1TAHDjDZbnbwJQ2NV514d3l0",
};
