const statusEl = document.getElementById("auth-status");
const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");

function setStatus(message, type = "") {
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function isConfigValid(config) {
  return Boolean(config && config.url && config.anonKey);
}

function getSupabaseClient() {
  const config = window.SUPABASE_CONFIG;
  const clientFactory = window.supabase && window.supabase.createClient;

  if (!clientFactory) {
    setStatus("Supabase SDK failed to load.", "error");
    return null;
  }

  if (!isConfigValid(config)) {
    setStatus("Supabase is not configured. Add url and anonKey in supabase-config.js.", "error");
    return null;
  }

  return clientFactory(config.url, config.anonKey);
}

async function handleLogin(event, supabaseClient) {
  event.preventDefault();

  const submitBtn = document.getElementById("login-submit");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  submitBtn.disabled = true;
  setStatus("Logging in...");

  try {
    const { error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    setStatus("Login successful. Redirecting...", "success");
    const redirectTo = window.SUPABASE_CONFIG.redirectTo || "index.html";
    window.location.href = redirectTo;
  } catch (error) {
    setStatus(`Login failed: ${error.message}`, "error");
  } finally {
    submitBtn.disabled = false;
  }
}

async function handleSignup(event, supabaseClient) {
  event.preventDefault();

  const submitBtn = document.getElementById("signup-submit");
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  submitBtn.disabled = true;
  setStatus("Creating account...");

  try {
    const { error } = await supabaseClient.auth.signUp({
      email,
      password,
    });

    if (error) {
      throw error;
    }

    setStatus("Account created. Check your email if confirmation is enabled.", "success");
  } catch (error) {
    setStatus(`Sign up failed: ${error.message}`, "error");
  } finally {
    submitBtn.disabled = false;
  }
}

async function initializeAuth() {
  const supabaseClient = getSupabaseClient();
  if (!supabaseClient) {
    return;
  }

  if (loginForm) {
    loginForm.addEventListener("submit", (event) => {
      handleLogin(event, supabaseClient);
    });
  }

  if (signupForm) {
    signupForm.addEventListener("submit", (event) => {
      handleSignup(event, supabaseClient);
    });
  }
}

initializeAuth();
