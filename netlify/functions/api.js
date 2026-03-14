const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

const CORS_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-User-Id, Stripe-Signature",
};

function sendJson(statusCode, payload) {
  return {
    statusCode,
    headers: CORS_HEADERS,
    body: payload === undefined ? "" : JSON.stringify(payload),
  };
}

function getHeader(headers, key) {
  if (!headers || typeof headers !== "object") {
    return "";
  }

  const match = Object.keys(headers).find(
    (headerName) => headerName.toLowerCase() === key.toLowerCase(),
  );

  return match ? headers[match] : "";
}

function decodeRawBody(event) {
  if (!event.body) {
    return Buffer.from("");
  }

  return Buffer.from(event.body, event.isBase64Encoded ? "base64" : "utf8");
}

function readJsonBody(event) {
  const rawText = decodeRawBody(event).toString("utf8").trim();
  if (!rawText) {
    return {};
  }

  return JSON.parse(rawText);
}

function normalizePath(path) {
  const rawPath = typeof path === "string" ? path : "/";
  const fromFunction = rawPath.startsWith("/.netlify/functions/api")
    ? `/api${rawPath.slice("/.netlify/functions/api".length)}`
    : rawPath;

  if (fromFunction.length > 1) {
    return fromFunction.replace(/\/+$/, "");
  }

  return fromFunction;
}

function hasSupabasePersistenceConfig() {
  return Boolean(supabaseAdmin);
}

function webhookLog(message, details = {}) {
  const timestamp = new Date().toISOString();
  const suffix =
    Object.keys(details).length > 0 ? ` ${JSON.stringify(details)}` : "";
  console.log(`[billing-webhook ${timestamp}] ${message}${suffix}`);
}

async function persistUserPlan(userId, plan) {
  if (!hasSupabasePersistenceConfig()) {
    return {
      persisted: false,
      warning:
        "Supabase persistence is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Netlify environment variables.",
    };
  }

  const nowIso = new Date().toISOString();

  const { error } = await supabaseAdmin.from("user_plans").upsert(
    {
      user_id: userId,
      plan,
      updated_at: nowIso,
    },
    {
      onConflict: "user_id",
    },
  );

  if (error) {
    return {
      persisted: false,
      warning: `Could not persist user plan in Supabase: ${error.message}`,
    };
  }

  return { persisted: true };
}

async function getVerifiedUserFromAccessToken(accessToken) {
  if (!hasSupabasePersistenceConfig()) {
    return {
      user: null,
      error:
        "Supabase persistence is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Netlify environment variables.",
      status: 500,
    };
  }

  const {
    data: { user },
    error,
  } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !user) {
    return { user: null, error: "Invalid access token.", status: 401 };
  }

  return { user, error: null, status: 200 };
}

async function appendTranscriptHistoryRow(userId, videoUrl, transcriptText) {
  if (!hasSupabasePersistenceConfig()) {
    return {
      saved: false,
      warning:
        "Supabase persistence is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Netlify environment variables.",
    };
  }

  const nowIso = new Date().toISOString();
  const transcriptId = randomUUID();

  const candidateRows = [
    {
      id: transcriptId,
      user_id: userId,
      video_url: videoUrl,
      transcript: transcriptText,
      created_at: nowIso,
      payload_json: JSON.stringify({ userId, videoUrl, createdAt: nowIso }),
    },
    {
      id: transcriptId,
      user_id: userId,
      videoUrl,
      transcript: transcriptText,
      created_at: nowIso,
      payloadJson: JSON.stringify({ userId, videoUrl, createdAt: nowIso }),
    },
    {
      id: transcriptId,
      userId: userId,
      videoUrl,
      output: transcriptText,
      created_at: nowIso,
      payloadJson: JSON.stringify({ userId, videoUrl, createdAt: nowIso }),
    },
    {
      user_id: userId,
      video_url: videoUrl,
      transcript: transcriptText,
      created_at: nowIso,
    },
  ];

  let lastError = null;

  for (const row of candidateRows) {
    const { error } = await supabaseAdmin
      .from("transcript_history")
      .insert(row);
    if (!error) {
      return { saved: true, table: "transcript_history", id: row.id || "" };
    }

    lastError = error;
  }

  const insertMessage = lastError?.message || "unknown error";
  const duplicateConstraint =
    insertMessage.includes("unique_user_video_transcript") ||
    insertMessage.toLowerCase().includes("duplicate key value");

  if (duplicateConstraint) {
    return {
      saved: false,
      warning:
        "Could not append transcript history row: unique constraint unique_user_video_transcript is preventing duplicates. Drop that constraint to keep multiple transcript runs in history.",
    };
  }

  return {
    saved: false,
    warning: `Could not append transcript history row: ${insertMessage}`,
  };
}

async function appendTranscriptFailureRow(
  userId,
  videoUrl,
  failureReason,
  rawResponse = "",
) {
  if (!hasSupabasePersistenceConfig()) {
    return {
      saved: false,
      warning:
        "Supabase persistence is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to Netlify environment variables.",
    };
  }

  const nowIso = new Date().toISOString();
  const failureId = randomUUID();

  const candidateRows = [
    {
      id: failureId,
      user_id: userId,
      video_url: videoUrl,
      failure_reason: failureReason,
      raw_response: rawResponse,
      created_at: nowIso,
    },
    {
      id: failureId,
      userId: userId,
      videoUrl,
      failureReason,
      rawResponse,
      created_at: nowIso,
    },
    {
      user_id: userId,
      video_url: videoUrl,
      failure_reason: failureReason,
      raw_response: rawResponse,
      created_at: nowIso,
    },
  ];

  let lastError = null;

  for (const row of candidateRows) {
    const { error } = await supabaseAdmin
      .from("transcript_failures")
      .insert(row);
    if (!error) {
      return { saved: true };
    }

    lastError = error;
  }

  return {
    saved: false,
    warning: `Could not append transcript failure row: ${lastError?.message || "unknown error"}`,
  };
}

async function logBillingEvent(event, userId, derivedPlan) {
  if (!hasSupabasePersistenceConfig()) {
    return;
  }

  const eventId = typeof event?.id === "string" ? event.id : "";
  if (!eventId) {
    return;
  }

  const eventType = typeof event?.type === "string" ? event.type : "unknown";

  const payload = {
    event_id: eventId,
    event_type: eventType,
    user_id: userId || null,
    derived_plan: derivedPlan || null,
    payload: event,
    created_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("billing_events").insert(payload);

  if (
    error &&
    !error.message
      .toLowerCase()
      .includes('relation "billing_events" does not exist')
  ) {
    console.error("Could not write billing event audit row:", error.message);
  }
}

function derivePlanFromSubscriptionStatus(subscription) {
  const status =
    typeof subscription?.status === "string" ? subscription.status : "";

  if (["active", "trialing", "past_due"].includes(status)) {
    return "pro";
  }

  if (["canceled", "unpaid", "incomplete_expired"].includes(status)) {
    return "free";
  }

  return null;
}

async function getUserIdFromSubscriptionObject(subscription) {
  const metadataUserId =
    typeof subscription?.metadata?.userId === "string"
      ? subscription.metadata.userId
      : "";

  if (metadataUserId) {
    return metadataUserId;
  }

  const subscriptionId =
    typeof subscription?.id === "string" ? subscription.id : "";
  if (!subscriptionId || !stripe) {
    return "";
  }

  try {
    const fullSubscription =
      await stripe.subscriptions.retrieve(subscriptionId);
    if (typeof fullSubscription?.metadata?.userId === "string") {
      return fullSubscription.metadata.userId;
    }
  } catch (error) {
    console.error(
      "Could not retrieve subscription for user mapping:",
      error.message,
    );
  }

  return "";
}

async function handleStripeWebhookEvent(event) {
  const object = event?.data?.object || {};
  const eventId = typeof event?.id === "string" ? event.id : "unknown";

  webhookLog("Event received", {
    eventId,
    eventType: event?.type || "unknown",
  });

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const userId = await getUserIdFromSubscriptionObject(object);
      const nextPlan = derivePlanFromSubscriptionStatus(object);

      webhookLog("Subscription event mapped", {
        eventId,
        userId: userId || "",
        nextPlan: nextPlan || "",
        subscriptionStatus:
          typeof object?.status === "string" ? object.status : "",
      });

      await logBillingEvent(event, userId, nextPlan);

      if (!userId || !nextPlan) {
        webhookLog("No plan change applied", {
          eventId,
          reason: "missing user mapping or unsupported status",
        });
        return { ok: true, message: "No plan change required." };
      }

      const persistResult = await persistUserPlan(userId, nextPlan);
      webhookLog("Plan persistence attempted", {
        eventId,
        userId,
        appliedPlan: nextPlan,
        persisted: persistResult.persisted,
        warning: persistResult.warning || "",
      });
      return {
        ok: persistResult.persisted,
        message:
          persistResult.warning || `Applied ${nextPlan} plan for ${userId}.`,
      };
    }

    case "checkout.session.completed": {
      const userId =
        typeof object?.client_reference_id === "string"
          ? object.client_reference_id
          : typeof object?.metadata?.userId === "string"
            ? object.metadata.userId
            : "";

      webhookLog("Checkout completion mapped", {
        eventId,
        userId: userId || "",
        checkoutSessionId: typeof object?.id === "string" ? object.id : "",
      });

      await logBillingEvent(event, userId, "pro");

      if (!userId) {
        webhookLog("No plan change applied", {
          eventId,
          reason: "missing user mapping on checkout completion",
        });
        return {
          ok: true,
          message: "Checkout completed without user mapping.",
        };
      }

      const persistResult = await persistUserPlan(userId, "pro");
      webhookLog("Plan persistence attempted", {
        eventId,
        userId,
        appliedPlan: "pro",
        persisted: persistResult.persisted,
        warning: persistResult.warning || "",
      });
      return {
        ok: persistResult.persisted,
        message: persistResult.warning || `Applied pro plan for ${userId}.`,
      };
    }

    default:
      await logBillingEvent(event, "", null);
      webhookLog("Event ignored", {
        eventId,
        eventType: event?.type || "unknown",
      });
      return { ok: true, message: `Ignored event type ${event.type}.` };
  }
}

exports.handler = async (event) => {
  const path = normalizePath(event.path);

  if (event.httpMethod === "OPTIONS") {
    return sendJson(204, {});
  }

  if (event.httpMethod === "POST" && path === "/api/stripe-webhook") {
    try {
      if (!stripe) {
        return sendJson(500, {
          error: "Missing STRIPE_SECRET_KEY environment variable.",
        });
      }

      if (!STRIPE_WEBHOOK_SECRET) {
        return sendJson(500, {
          error: "Missing STRIPE_WEBHOOK_SECRET environment variable.",
        });
      }

      const signature = getHeader(event.headers, "stripe-signature");
      if (!signature) {
        return sendJson(400, { error: "Missing Stripe signature header." });
      }

      const rawBody = decodeRawBody(event);
      const stripeEvent = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        STRIPE_WEBHOOK_SECRET,
      );

      const result = await handleStripeWebhookEvent(stripeEvent);
      webhookLog("Webhook handled", {
        eventId: stripeEvent.id,
        eventType: stripeEvent.type,
        ok: result.ok,
        message: result.message,
      });
      return sendJson(200, { received: true, message: result.message });
    } catch (error) {
      webhookLog("Webhook handling failed", {
        error: error.message || "unknown error",
      });
      return sendJson(400, {
        error: error.message || "Invalid Stripe webhook event.",
      });
    }
  }

  if (event.httpMethod === "POST" && path === "/api/create-checkout-session") {
    try {
      if (!stripe) {
        return sendJson(500, {
          error: "Missing STRIPE_SECRET_KEY environment variable.",
        });
      }

      const body = readJsonBody(event);
      const userId = typeof body.userId === "string" ? body.userId : "";
      const email = typeof body.email === "string" ? body.email : "";
      const priceId = typeof body.priceId === "string" ? body.priceId : "";
      const successUrl =
        typeof body.successUrl === "string" ? body.successUrl : "";
      const cancelUrl =
        typeof body.cancelUrl === "string" ? body.cancelUrl : "";

      if (!userId || !priceId || !successUrl || !cancelUrl) {
        return sendJson(400, {
          error:
            "Missing required fields: userId, priceId, successUrl, cancelUrl.",
        });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: cancelUrl,
        client_reference_id: userId,
        customer_email: email || undefined,
        metadata: {
          userId,
          plan: "pro",
        },
        subscription_data: {
          metadata: {
            userId,
            plan: "pro",
          },
        },
      });

      return sendJson(200, { url: session.url });
    } catch (error) {
      return sendJson(500, {
        error: error.message || "Failed to create checkout session.",
      });
    }
  }

  if (event.httpMethod === "POST" && path === "/api/verify-checkout-session") {
    try {
      if (!stripe) {
        return sendJson(500, {
          error: "Missing STRIPE_SECRET_KEY environment variable.",
        });
      }

      const body = readJsonBody(event);
      const sessionId =
        typeof body.sessionId === "string" ? body.sessionId : "";

      if (!sessionId) {
        return sendJson(400, { error: "Missing required field: sessionId." });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const paid =
        session.payment_status === "paid" || session.status === "complete";
      const userId =
        session.client_reference_id || session.metadata?.userId || "";

      let persistResult = { persisted: false };
      if (paid && userId) {
        persistResult = await persistUserPlan(userId, "pro");
      }

      return sendJson(200, {
        paid,
        userId,
        customerEmail: session.customer_details?.email || "",
        persisted: persistResult.persisted,
        warning: persistResult.warning || "",
      });
    } catch (error) {
      return sendJson(500, {
        error: error.message || "Failed to verify checkout session.",
      });
    }
  }

  if (event.httpMethod === "POST" && path === "/api/get-user-plan") {
    try {
      const body = readJsonBody(event);
      const userId = typeof body.userId === "string" ? body.userId : "";
      const accessToken =
        typeof body.accessToken === "string" ? body.accessToken : "";

      if (!userId || !accessToken) {
        return sendJson(400, {
          error: "Missing required fields: userId and accessToken.",
        });
      }

      const verified = await getVerifiedUserFromAccessToken(accessToken);
      if (!verified.user) {
        return sendJson(verified.status, { error: verified.error });
      }

      if (verified.user.id !== userId) {
        return sendJson(403, { error: "Forbidden: user mismatch." });
      }

      const { data, error } = await supabaseAdmin
        .from("user_plans")
        .select("plan, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(1);

      if (error) {
        return sendJson(500, {
          error: `Could not fetch user plan from Supabase: ${error.message}`,
        });
      }

      const latest = Array.isArray(data) && data.length > 0 ? data[0] : null;
      return sendJson(200, {
        plan: latest?.plan === "pro" ? "pro" : "free",
      });
    } catch (error) {
      return sendJson(500, {
        error: error.message || "Failed to load user plan.",
      });
    }
  }

  if (event.httpMethod === "POST" && path === "/api/get-transcript-history") {
    try {
      const body = readJsonBody(event);
      const userId = typeof body.userId === "string" ? body.userId : "";
      const accessToken =
        typeof body.accessToken === "string" ? body.accessToken : "";
      const requestedLimit = Number(body.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(200, requestedLimit))
        : 100;

      if (!userId || !accessToken) {
        return sendJson(400, {
          error: "Missing required fields: userId and accessToken.",
        });
      }

      const verified = await getVerifiedUserFromAccessToken(accessToken);
      if (!verified.user) {
        return sendJson(verified.status, { error: verified.error });
      }

      if (verified.user.id !== userId) {
        return sendJson(403, { error: "Forbidden: user mismatch." });
      }

      const { data, error } = await supabaseAdmin
        .from("transcript_history")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        return sendJson(500, {
          error: `Could not fetch transcript history: ${error.message}`,
        });
      }

      const rows = Array.isArray(data) ? data : [];
      webhookLog("Transcript history fetched", {
        userId,
        rowCount: rows.length,
      });
      return sendJson(200, {
        source: "transcript_history",
        rows,
      });
    } catch (error) {
      return sendJson(500, {
        error: error.message || "Failed to load transcript history.",
      });
    }
  }

  if (
    event.httpMethod === "POST" &&
    path === "/api/append-transcript-history"
  ) {
    try {
      const body = readJsonBody(event);
      const authHeader = getHeader(event.headers, "authorization");
      const headerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";

      const userId =
        typeof body.userId === "string"
          ? body.userId
          : typeof body.user_id === "string"
            ? body.user_id
            : getHeader(event.headers, "x-user-id");

      const accessToken =
        typeof body.accessToken === "string"
          ? body.accessToken
          : typeof body.access_token === "string"
            ? body.access_token
            : headerToken;

      const videoUrl =
        typeof body.videoUrl === "string"
          ? body.videoUrl
          : typeof body.video_url === "string"
            ? body.video_url
            : typeof body.url === "string"
              ? body.url
              : "";

      const transcriptText =
        typeof body.transcriptText === "string"
          ? body.transcriptText
          : typeof body.transcript === "string"
            ? body.transcript
            : typeof body.output === "string"
              ? body.output
              : typeof body.text === "string"
                ? body.text
                : "";

      if (!userId || !accessToken || !videoUrl || !transcriptText) {
        return sendJson(400, {
          error:
            "Missing required fields: userId, accessToken, videoUrl, transcriptText.",
        });
      }

      const verified = await getVerifiedUserFromAccessToken(accessToken);
      if (!verified.user) {
        return sendJson(verified.status, { error: verified.error });
      }

      if (verified.user.id !== userId) {
        return sendJson(403, { error: "Forbidden: user mismatch." });
      }

      const result = await appendTranscriptHistoryRow(
        userId,
        videoUrl,
        transcriptText,
      );

      if (!result.saved) {
        webhookLog("Transcript history append failed", {
          userId,
          warning: result.warning || "",
        });
        return sendJson(500, {
          error: result.warning || "Could not append transcript history.",
        });
      }

      webhookLog("Transcript history append saved", {
        userId,
        table: result.table || "transcript_history",
        id: result.id || "",
      });
      return sendJson(200, {
        saved: true,
        table: result.table || "transcript_history",
        id: result.id || "",
      });
    } catch (error) {
      webhookLog("Transcript history append crashed", {
        error: error.message || "unknown error",
      });
      return sendJson(500, {
        error: error.message || "Failed to append transcript history.",
      });
    }
  }

  if (
    event.httpMethod === "POST" &&
    path === "/api/append-transcript-failure"
  ) {
    try {
      const body = readJsonBody(event);
      const authHeader = getHeader(event.headers, "authorization");
      const headerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";

      const userId =
        typeof body.userId === "string"
          ? body.userId
          : typeof body.user_id === "string"
            ? body.user_id
            : getHeader(event.headers, "x-user-id");

      const accessToken =
        typeof body.accessToken === "string"
          ? body.accessToken
          : typeof body.access_token === "string"
            ? body.access_token
            : headerToken;

      const videoUrl =
        typeof body.videoUrl === "string"
          ? body.videoUrl
          : typeof body.video_url === "string"
            ? body.video_url
            : typeof body.url === "string"
              ? body.url
              : "";

      const failureReason =
        typeof body.failureReason === "string"
          ? body.failureReason
          : typeof body.failure_reason === "string"
            ? body.failure_reason
            : typeof body.error === "string"
              ? body.error
              : "";

      const rawResponse =
        typeof body.rawResponse === "string"
          ? body.rawResponse
          : typeof body.raw_response === "string"
            ? body.raw_response
            : "";

      if (!userId || !accessToken || !videoUrl || !failureReason) {
        return sendJson(400, {
          error:
            "Missing required fields: userId, accessToken, videoUrl, failureReason.",
        });
      }

      const verified = await getVerifiedUserFromAccessToken(accessToken);
      if (!verified.user) {
        return sendJson(verified.status, { error: verified.error });
      }

      if (verified.user.id !== userId) {
        return sendJson(403, { error: "Forbidden: user mismatch." });
      }

      const result = await appendTranscriptFailureRow(
        userId,
        videoUrl,
        failureReason,
        rawResponse,
      );

      if (!result.saved) {
        return sendJson(500, {
          error: result.warning || "Could not append transcript failure.",
        });
      }

      return sendJson(200, { saved: true });
    } catch (error) {
      return sendJson(500, {
        error: error.message || "Failed to append transcript failure.",
      });
    }
  }

  return sendJson(404, { error: `No route for ${event.httpMethod} ${path}.` });
};
