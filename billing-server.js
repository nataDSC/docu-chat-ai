const http = require("http");
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");
require("dotenv").config();

const PORT = Number(process.env.BILLING_PORT || 4242);
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!STRIPE_SECRET_KEY) {
  console.error("Missing STRIPE_SECRET_KEY environment variable.");
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY);
const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id",
  });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON payload."));
      }
    });
    req.on("error", (error) => reject(error));
  });
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });
    req.on("error", (error) => reject(error));
  });
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
        "Supabase persistence is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.",
    };
  }

  const nowIso = new Date().toISOString();

  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("user_plans")
    .select("id")
    .eq("user_id", userId)
    .limit(1);

  if (existingError) {
    return {
      persisted: false,
      warning: `Could not inspect current plan row in Supabase: ${existingError.message}`,
    };
  }

  if (Array.isArray(existingRows) && existingRows.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from("user_plans")
      .update({
        plan,
        updated_at: nowIso,
      })
      .eq("user_id", userId);

    if (updateError) {
      return {
        persisted: false,
        warning: `Could not update user plan in Supabase: ${updateError.message}`,
      };
    }

    return { persisted: true };
  }

  const { data: latestRows, error: latestError } = await supabaseAdmin
    .from("user_plans")
    .select("id")
    .order("id", { ascending: false })
    .limit(1);

  if (latestError) {
    return {
      persisted: false,
      warning: `Could not allocate a new plan row id: ${latestError.message}`,
    };
  }

  const maxId =
    Array.isArray(latestRows) && latestRows.length > 0
      ? Number(latestRows[0].id) || 0
      : 0;
  const nextId = maxId + 1;

  const { error: insertError } = await supabaseAdmin.from("user_plans").insert({
    id: nextId,
    user_id: userId,
    plan,
    updated_at: nowIso,
  });

  if (insertError) {
    return {
      persisted: false,
      warning: `Could not insert user plan in Supabase: ${insertError.message}`,
    };
  }

  return { persisted: true };
}

async function getVerifiedUserFromAccessToken(accessToken) {
  if (!hasSupabasePersistenceConfig()) {
    return {
      user: null,
      error:
        "Supabase persistence is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.",
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
        "Supabase persistence is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.",
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
    const { error } = await supabaseAdmin.from("transcript_history").insert(row);
    if (!error) {
      return { saved: true, table: "transcript_history", id: row.id || "" };
    }

    lastError = error;
  }

  const insertMessage = lastError.message || "unknown error";
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

async function appendTranscriptFailureRow(userId, videoUrl, failureReason, rawResponse = "") {
  if (!hasSupabasePersistenceConfig()) {
    return {
      saved: false,
      warning:
        "Supabase persistence is not configured. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.",
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
    const { error } = await supabaseAdmin.from("transcript_failures").insert(row);
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
  if (!subscriptionId) {
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

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "POST" && req.url === "/api/stripe-webhook") {
    try {
      if (!STRIPE_WEBHOOK_SECRET) {
        sendJson(res, 500, {
          error: "Missing STRIPE_WEBHOOK_SECRET environment variable.",
        });
        return;
      }

      const signature = req.headers["stripe-signature"];
      if (typeof signature !== "string" || !signature) {
        sendJson(res, 400, { error: "Missing Stripe signature header." });
        return;
      }

      const rawBody = await readRawBody(req);
      const event = stripe.webhooks.constructEvent(
        rawBody,
        signature,
        STRIPE_WEBHOOK_SECRET,
      );

      const result = await handleStripeWebhookEvent(event);
      webhookLog("Webhook handled", {
        eventId: event.id,
        eventType: event.type,
        ok: result.ok,
        message: result.message,
      });
      sendJson(res, 200, { received: true, message: result.message });
    } catch (error) {
      webhookLog("Webhook handling failed", {
        error: error.message || "unknown error",
      });
      sendJson(res, 400, {
        error: error.message || "Invalid Stripe webhook event.",
      });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/create-checkout-session") {
    try {
      const body = await readBody(req);
      const userId = typeof body.userId === "string" ? body.userId : "";
      const email = typeof body.email === "string" ? body.email : "";
      const priceId = typeof body.priceId === "string" ? body.priceId : "";
      const successUrl =
        typeof body.successUrl === "string" ? body.successUrl : "";
      const cancelUrl =
        typeof body.cancelUrl === "string" ? body.cancelUrl : "";

      if (!userId || !priceId || !successUrl || !cancelUrl) {
        sendJson(res, 400, {
          error:
            "Missing required fields: userId, priceId, successUrl, cancelUrl.",
        });
        return;
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

      sendJson(res, 200, { url: session.url });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || "Failed to create checkout session.",
      });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/verify-checkout-session") {
    try {
      const body = await readBody(req);
      const sessionId =
        typeof body.sessionId === "string" ? body.sessionId : "";

      if (!sessionId) {
        sendJson(res, 400, { error: "Missing required field: sessionId." });
        return;
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

      sendJson(res, 200, {
        paid,
        userId,
        customerEmail: session.customer_details?.email || "",
        persisted: persistResult.persisted,
        warning: persistResult.warning || "",
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || "Failed to verify checkout session.",
      });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/get-user-plan") {
    try {
      const body = await readBody(req);
      const userId = typeof body.userId === "string" ? body.userId : "";
      const accessToken =
        typeof body.accessToken === "string" ? body.accessToken : "";

      if (!userId || !accessToken) {
        sendJson(res, 400, {
          error: "Missing required fields: userId and accessToken.",
        });
        return;
      }

      const verified = await getVerifiedUserFromAccessToken(accessToken);
      if (!verified.user) {
        sendJson(res, verified.status, { error: verified.error });
        return;
      }

      if (verified.user.id !== userId) {
        sendJson(res, 403, { error: "Forbidden: user mismatch." });
        return;
      }

      const { data, error } = await supabaseAdmin
        .from("user_plans")
        .select("id, plan, updated_at")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(1);

      if (error) {
        sendJson(res, 500, {
          error: `Could not fetch user plan from Supabase: ${error.message}`,
        });
        return;
      }

      const latest = Array.isArray(data) && data.length > 0 ? data[0] : null;

      sendJson(res, 200, {
        plan: latest?.plan === "pro" ? "pro" : "free",
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || "Failed to load user plan.",
      });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/get-transcript-history") {
    try {
      const body = await readBody(req);
      const userId = typeof body.userId === "string" ? body.userId : "";
      const accessToken =
        typeof body.accessToken === "string" ? body.accessToken : "";
      const requestedLimit = Number(body.limit);
      const limit = Number.isFinite(requestedLimit)
        ? Math.max(1, Math.min(200, requestedLimit))
        : 100;

      if (!userId || !accessToken) {
        sendJson(res, 400, {
          error: "Missing required fields: userId and accessToken.",
        });
        return;
      }

      const verified = await getVerifiedUserFromAccessToken(accessToken);
      if (!verified.user) {
        sendJson(res, verified.status, { error: verified.error });
        return;
      }

      if (verified.user.id !== userId) {
        sendJson(res, 403, { error: "Forbidden: user mismatch." });
        return;
      }

      let data = null;
      let error = null;

      const attempts = [
        {
          mode: "user_id",
          run: () =>
            supabaseAdmin
              .from("transcript_history")
              .select("*")
              .eq("user_id", userId)
              .order("created_at", { ascending: false })
              .limit(limit),
        },
        {
          mode: "userId",
          run: () =>
            supabaseAdmin
              .from("transcript_history")
              .select("*")
              .eq("userId", userId)
              .order("created_at", { ascending: false })
              .limit(limit),
        },
      ];

      for (const attempt of attempts) {
        const result = await attempt.run();
        data = result.data;
        error = result.error;
        if (!error && Array.isArray(data) && data.length > 0) {
          break;
        }

        if (!error && Array.isArray(data) && data.length === 0) {
          continue;
        }
      }

      if (error) {
        sendJson(res, 500, {
          error: `Could not fetch transcript history: ${error.message}`,
        });
        return;
      }

      const rows = Array.isArray(data) ? data : [];
      webhookLog("Transcript history fetched", {
        userId,
        rowCount: rows.length,
      });

      sendJson(res, 200, {
        source: "transcript_history",
        rows,
      });
    } catch (error) {
      sendJson(res, 500, {
        error: error.message || "Failed to load transcript history.",
      });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/append-transcript-history") {
    try {
      const rawBody = await readRawBody(req);
      const rawText = rawBody.toString("utf8");
      const body = rawText.trim() ? JSON.parse(rawText) : {};

      const authHeader =
        typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : "";
      const headerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";

      const userId =
        typeof body.userId === "string"
          ? body.userId
          : typeof body.user_id === "string"
            ? body.user_id
            : typeof req.headers["x-user-id"] === "string"
              ? req.headers["x-user-id"]
              : "";

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
      const missing = {
        userId: !userId,
        accessToken: !accessToken,
        videoUrl: !videoUrl,
        transcriptText: !transcriptText,
      };

      webhookLog("Transcript history append requested", {
        rawBodyLength: rawBody.length,
        userId: userId || "",
        hasAccessToken: Boolean(accessToken),
        videoUrlPreview: videoUrl ? videoUrl.slice(0, 80) : "",
        transcriptLength: transcriptText.length,
      });

      if (!userId || !accessToken || !videoUrl || !transcriptText) {
        webhookLog("Transcript history append rejected", {
          reason: "missing required fields",
          missing,
        });
        sendJson(res, 400, {
          error:
            "Missing required fields: userId, accessToken, videoUrl, transcriptText.",
        });
        return;
      }

      const verified = await getVerifiedUserFromAccessToken(accessToken);
      if (!verified.user) {
        webhookLog("Transcript history append rejected", {
          reason: "invalid access token",
          status: verified.status,
        });
        sendJson(res, verified.status, { error: verified.error });
        return;
      }

      if (verified.user.id !== userId) {
        webhookLog("Transcript history append rejected", {
          reason: "user mismatch",
          tokenUserId: verified.user.id,
          requestUserId: userId,
        });
        sendJson(res, 403, { error: "Forbidden: user mismatch." });
        return;
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
        sendJson(res, 500, {
          error: result.warning || "Could not append transcript history.",
        });
        return;
      }

      webhookLog("Transcript history append saved", {
        userId,
        table: result.table || "transcript_history",
        id: result.id || "",
      });
      sendJson(res, 200, {
        saved: true,
        table: result.table || "transcript_history",
        id: result.id || "",
      });
    } catch (error) {
      webhookLog("Transcript history append crashed", {
        error: error.message || "unknown error",
      });
      sendJson(res, 500, {
        error: error.message || "Failed to append transcript history.",
      });
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/append-transcript-failure") {
    try {
      const rawBody = await readRawBody(req);
      const rawText = rawBody.toString("utf8");
      const body = rawText.trim() ? JSON.parse(rawText) : {};

      const authHeader =
        typeof req.headers.authorization === "string"
          ? req.headers.authorization
          : "";
      const headerToken = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : "";

      const userId =
        typeof body.userId === "string"
          ? body.userId
          : typeof body.user_id === "string"
            ? body.user_id
            : typeof req.headers["x-user-id"] === "string"
              ? req.headers["x-user-id"]
              : "";

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

      webhookLog("Transcript failure append requested", {
        rawBodyLength: rawBody.length,
        userId: userId || "",
        hasAccessToken: Boolean(accessToken),
        videoUrlPreview: videoUrl ? videoUrl.slice(0, 80) : "",
        failureReasonPreview: failureReason ? failureReason.slice(0, 120) : "",
      });

      if (!userId || !accessToken || !videoUrl || !failureReason) {
        sendJson(res, 400, {
          error:
            "Missing required fields: userId, accessToken, videoUrl, failureReason.",
        });
        return;
      }

      const verified = await getVerifiedUserFromAccessToken(accessToken);
      if (!verified.user) {
        sendJson(res, verified.status, { error: verified.error });
        return;
      }

      if (verified.user.id !== userId) {
        sendJson(res, 403, { error: "Forbidden: user mismatch." });
        return;
      }

      const result = await appendTranscriptFailureRow(
        userId,
        videoUrl,
        failureReason,
        rawResponse,
      );

      if (!result.saved) {
        webhookLog("Transcript failure append failed", {
          userId,
          warning: result.warning || "",
        });
        sendJson(res, 500, {
          error: result.warning || "Could not append transcript failure.",
        });
        return;
      }

      webhookLog("Transcript failure append saved", { userId });
      sendJson(res, 200, { saved: true });
    } catch (error) {
      webhookLog("Transcript failure append crashed", {
        error: error.message || "unknown error",
      });
      sendJson(res, 500, {
        error: error.message || "Failed to append transcript failure.",
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Not found." });
});

server.listen(PORT, () => {
  console.log(`Billing API listening on http://localhost:${PORT}`);
});
