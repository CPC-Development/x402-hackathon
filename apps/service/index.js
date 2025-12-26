const express = require("express");

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = Number(process.env.PORT || 4000);
const FACILITATOR_URL = process.env.FACILITATOR_URL || "http://facilitator:8080";
const SEQUENCER_URL = process.env.SEQUENCER_URL || "http://sequencer:4001";
const NOMINATIM_URL = process.env.NOMINATIM_URL || "http://nominatim:8080";
const CHAIN_ID = Number(process.env.CHAIN_ID || 31337);
const CHANNEL_MANAGER_ADDRESS = process.env.CHANNEL_MANAGER_ADDRESS || "";
const USDC_ADDRESS = process.env.USDC_ADDRESS || "";
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS || "";
const PRICE = process.env.PRICE || "1000000"; // 1 USDC (6 decimals)
const DUMMY_PRICE = process.env.DUMMY_PRICE || "1"; // 1 micro USDC (1e-6)
const MAX_TIMEOUT_SECONDS = Number(process.env.MAX_TIMEOUT_SECONDS || 900);
const TIMESTAMP_SKEW_SECONDS = Number(process.env.TIMESTAMP_SKEW_SECONDS || 900);
const MAX_RECIPIENTS = Number(process.env.MAX_RECIPIENTS || 30);
const HEALTH_TIMEOUT_MS = Number(process.env.HEALTH_TIMEOUT_MS || 1500);
const BOOTSTRAP_EXPIRY_SECONDS = Number(process.env.CHANNEL_BOOTSTRAP_EXPIRY_SECONDS || 24 * 60 * 60);
const BOOTSTRAP_CHANNEL_AMOUNT = process.env.CHANNEL_BOOTSTRAP_AMOUNT || "";

if (!CHANNEL_MANAGER_ADDRESS || !USDC_ADDRESS || !PAY_TO_ADDRESS) {
  // eslint-disable-next-line no-console
  console.warn(
    "Missing env: CHANNEL_MANAGER_ADDRESS, USDC_ADDRESS, or PAY_TO_ADDRESS. Service will return 500 on paid routes."
  );
}

function buildRequirements(req, channel, price, description) {
  return {
    scheme: "cpc",
    network: `eip155:${CHAIN_ID}`,
    maxAmountRequired: price,
    resource: req.path,
    description,
    mimeType: "application/json",
    outputSchema: null,
    payTo: PAY_TO_ADDRESS,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    asset: USDC_ADDRESS,
    extra: {
      channelId: channel.channelId,
      nextSequenceNumber: channel.sequenceNumber + 1,
      channelExpiry: channel.expiryTimestamp,
      channelManager: CHANNEL_MANAGER_ADDRESS,
      domain: {
        name: "X402CheddrPaymentChannel",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: CHANNEL_MANAGER_ADDRESS
      },
      timestampSkewSeconds: TIMESTAMP_SKEW_SECONDS,
      maxRecipients: MAX_RECIPIENTS
    }
  };
}

function buildBootstrapRequirements(req, channelAmount, channelExpiry, price, description) {
  return {
    scheme: "cpc",
    network: `eip155:${CHAIN_ID}`,
    maxAmountRequired: price,
    resource: req.path,
    description,
    mimeType: "application/json",
    outputSchema: null,
    payTo: PAY_TO_ADDRESS,
    maxTimeoutSeconds: MAX_TIMEOUT_SECONDS,
    asset: USDC_ADDRESS,
    extra: {
      channelId: "0x0000000000000000000000000000000000000000000000000000000000000000",
      nextSequenceNumber: 1,
      channelExpiry: channelExpiry,
      channelManager: CHANNEL_MANAGER_ADDRESS,
      channelAmount: channelAmount,
      domain: {
        name: "X402CheddrPaymentChannel",
        version: "1",
        chainId: CHAIN_ID,
        verifyingContract: CHANNEL_MANAGER_ADDRESS
      },
      timestampSkewSeconds: TIMESTAMP_SKEW_SECONDS,
      maxRecipients: MAX_RECIPIENTS
    }
  };
}

function parsePaymentHeader(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  return JSON.parse(decoded);
}

async function fetchJson(url, options) {
  try {
    const resp = await fetch(url, options);
    const text = await resp.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (_err) {
        json = null;
      }
    }
    return { resp, json, text };
  } catch (err) {
    return { resp: null, json: null, error: err };
  }
}

async function probe(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveChannelById(channelId) {
  if (!channelId) {
    return { error: { error: "Missing channelId" }, status: 400 };
  }
  const { resp, json } = await fetchJson(`${SEQUENCER_URL}/channel/${channelId}`);
  if (!resp) {
    return { error: { error: "sequencer unavailable" }, status: 502 };
  }
  if (!resp.ok) {
    return { error: json || { error: "channel not found" }, status: resp.status };
  }
  return { channel: json };
}

async function resolveChannelByOwner(owner) {
  if (!owner) {
    return { error: { error: "Missing owner query parameter" }, status: 400 };
  }
  const { resp, json } = await fetchJson(`${SEQUENCER_URL}/channels/by-owner/${owner}`);
  if (!resp) {
    return { error: { error: "sequencer unavailable" }, status: 502 };
  }
  if (!resp.ok) {
    return { error: json || { error: "owner lookup failed" }, status: resp.status };
  }
  const channelIds = json.channelIds || [];
  if (channelIds.length === 0) {
    return { bootstrap: true };
  }
  const latestChannelId = channelIds[channelIds.length - 1];
  const channelResult = await resolveChannelById(latestChannelId);
  if (!channelResult.channel && channelResult.status === 404) {
    return { bootstrap: true };
  }
  return channelResult;
}

async function requirePayment(req, res, options = {}) {
  const price = options.price ?? PRICE;
  const description = options.description ?? "Monaco micro-geocoder (Nominatim)";
  if (!CHANNEL_MANAGER_ADDRESS || !USDC_ADDRESS || !PAY_TO_ADDRESS) {
    res.status(500).json({ error: "Service not configured" });
    return null;
  }

  const paymentHeader = req.get("X-PAYMENT");

  if (!paymentHeader) {
    const channelResult = await resolveChannelByOwner(req.query.owner);
    let requirements;
    if (channelResult?.channel) {
      requirements = buildRequirements(req, channelResult.channel, price, description);
    } else if (channelResult?.bootstrap) {
      let channelAmount = BOOTSTRAP_CHANNEL_AMOUNT;
      if (!channelAmount) {
        try {
          channelAmount = (BigInt(price) * 10n).toString();
        } catch {
          channelAmount = "10000000";
        }
      }
      const channelExpiry = Math.floor(Date.now() / 1000) + BOOTSTRAP_EXPIRY_SECONDS;
      requirements = buildBootstrapRequirements(req, channelAmount, channelExpiry, price, description);
    } else {
      res.status(channelResult.status || 400).json(channelResult.error);
      return null;
    }
    res.status(402).json({
      error: "X-PAYMENT header is required",
      accepts: [requirements],
      x402Version: 1
    });
    return null;
  }

  let paymentPayload;
  try {
    paymentPayload = parsePaymentHeader(paymentHeader);
  } catch (err) {
    res.status(400).json({ error: "Invalid X-PAYMENT header" });
    return null;
  }

  const channelId = paymentPayload?.payload?.channelId;
  const channelResult = await resolveChannelById(channelId);
  if (!channelResult.channel) {
    res.status(channelResult.status || 400).json(channelResult.error);
    return null;
  }

  const requirements = buildRequirements(req, channelResult.channel, price, description);
  const verifyBody = {
    x402Version: 1,
    paymentPayload,
    paymentRequirements: requirements
  };

  const verify = await fetchJson(`${FACILITATOR_URL}/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(verifyBody)
  });

  if (!verify.resp) {
    res.status(502).json({ error: "facilitator unavailable" });
    return null;
  }
  if (!verify.resp.ok) {
    res.status(verify.resp.status).json(verify.json || { error: "verify failed" });
    return null;
  }

  const settle = await fetchJson(`${FACILITATOR_URL}/settle`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(verifyBody)
  });

  if (!settle.resp) {
    res.status(502).json({ error: "facilitator unavailable" });
    return null;
  }
  if (!settle.resp.ok) {
    res.status(settle.resp.status).json(settle.json || { error: "settle failed" });
    return null;
  }

  const paymentResponseHeader = Buffer.from(JSON.stringify(settle.json || {})).toString("base64");
  return { paymentResponseHeader };
}

app.get("/health", (_req, res) => {
  Promise.all([
    probe(`${NOMINATIM_URL}/search?q=monaco&format=jsonv2&limit=1&countrycodes=mc`),
    probe(`${FACILITATOR_URL}/health`),
    probe(`${SEQUENCER_URL}/health`)
  ])
    .then(([nominatim, facilitator, sequencer]) => {
      const ok = nominatim.ok && facilitator.ok && sequencer.ok;
      res.status(ok ? 200 : 502).json({
        ok,
        dependencies: {
          nominatim,
          facilitator,
          sequencer
        }
      });
    })
    .catch((err) => {
      res.status(500).json({ ok: false, error: err?.message || String(err) });
    });
});

app.get("/geocode", async (req, res) => {
  const query = req.query.query;
  if (!query) {
    res.status(400).json({ error: "Missing query" });
    return;
  }

  const payment = await requirePayment(req, res);
  if (!payment) return;

  const url = new URL("/search", NOMINATIM_URL);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "mc");
  if (req.query.limit) url.searchParams.set("limit", req.query.limit);
  if (req.query.lang) url.searchParams.set("accept-language", req.query.lang);

  const upstream = await fetch(url.toString());
  const body = await upstream.text();
  res.status(upstream.status);
  res.set("Content-Type", upstream.headers.get("content-type") || "application/json");
  res.set("X-PAYMENT-RESPONSE", payment.paymentResponseHeader);
  res.send(body);
});

app.get("/reverse", async (req, res) => {
  const lat = req.query.lat;
  const lon = req.query.lon;
  if (!lat || !lon) {
    res.status(400).json({ error: "Missing lat or lon" });
    return;
  }

  const payment = await requirePayment(req, res);
  if (!payment) return;

  const url = new URL("/reverse", NOMINATIM_URL);
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  if (req.query.lang) url.searchParams.set("accept-language", req.query.lang);

  const upstream = await fetch(url.toString());
  const body = await upstream.text();
  res.status(upstream.status);
  res.set("Content-Type", upstream.headers.get("content-type") || "application/json");
  res.set("X-PAYMENT-RESPONSE", payment.paymentResponseHeader);
  res.send(body);
});

app.get("/dummy", async (req, res) => {
  const payment = await requirePayment(req, res, {
    price: DUMMY_PRICE,
    description: "Dummy paid ping (1 micro USDC)"
  });
  if (!payment) return;

  res.status(200);
  res.set("Content-Type", "text/plain");
  res.set("X-PAYMENT-RESPONSE", payment.paymentResponseHeader);
  res.send("1");
});

app.listen(PORT, "0.0.0.0", () => {
  // eslint-disable-next-line no-console
  console.log(`Paid proxy listening on :${PORT}`);
});
