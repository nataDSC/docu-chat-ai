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

window.SUPABASE_CONFIG = {
  environment: activeEnvironment,
  url: selectedConfig.url,
  anonKey: selectedConfig.anonKey,
  redirectTo: window.location.origin + "/index.html",
};

window.BILLING_CONFIG = {
  apiBaseUrl: "http://localhost:4242",
  // Replace with your Stripe Price ID (e.g. price_12345)
  proPriceId: "price_1TAHDjDZbnbwJQ2NV514d3l0",
};
