import { readFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AbiCoder,
  Contract,
  HDNodeWallet,
  JsonRpcProvider,
  NonceManager,
  Signer,
  Wallet,
  getAddress,
  isAddress,
  keccak256,
  solidityPacked,
  toUtf8Bytes
} from "ethers";

type DemoConfig = {
  rpcUrl?: string;
  serviceUrl?: string;
  privateKey?: string;
  mnemonic?: string;
  accountIndex?: number;
  channelAmount?: string;
  channelExpirySeconds?: number;
  query?: string;
  purpose?: string;
};

type ResolvedConfig = {
  rpcUrl: string;
  serviceUrl: string;
  sequencerUrl: string;
  privateKey: string;
  channelAmount?: bigint;
  channelExpirySeconds: number;
  query: string;
  purpose?: string;
};

type PaymentRequirements = {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource?: string;
  description?: string;
  mimeType?: string;
  payTo: string;
  asset: string;
  extra?: {
    channelId: string;
    nextSequenceNumber: number;
    channelExpiry: number;
    channelManager: string;
    channelAmount?: string;
    domain?: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: string;
    };
    timestampSkewSeconds?: number;
    maxRecipients?: number;
    feeDestinationAddress?: string;
  };
};

type ChannelView = {
  channelId: string;
  owner: string;
  balance: string;
  expiryTimestamp: number;
  sequenceNumber: number;
  userSignature: string;
  sequencerSignature: string;
  signatureTimestamp: number;
  recipients: RecipientView[];
};

type RecipientView = {
  recipientAddress: string;
  balance: string;
};

type ChannelsByOwnerResponse = {
  owner: string;
  channelIds: string[];
};

type PayInChannelPayload = {
  channelId: string;
  amount: string;
  receiver: string;
  sequenceNumber: number;
  timestamp: number;
  userSignature: string;
  purpose?: string;
};

type ChannelDomain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: string;
};

const CHANNEL_ABI = [
  "function channels(bytes32) view returns (address owner,uint256 balance,uint256 expiryTime,uint256 sequenceNumber)",
  "function getChannelId(address owner,uint256 expiryTime,uint256 amount) view returns (bytes32)",
  "function openChannel(uint256 amount,uint256 expiryTime,uint256 signatureTimestamp,bytes userSignature) returns (bytes32)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = resolve(__dirname, "config.json");
const CACHE_DIR = resolve(__dirname, ".cache");
const REQUIREMENTS_CACHE_PATH = resolve(CACHE_DIR, "geocode-requirements.json");
const MONACO_RESPONSE_PATH = resolve(CACHE_DIR, "monaco.json");
const CHANNEL_DATA_TYPEHASH = keccak256(
  toUtf8Bytes("ChannelData(bytes32 channelId,uint256 sequenceNumber,uint256 timestamp,address[] recipients,uint256[] amounts)")
);
const DOMAIN_TYPEHASH = keccak256(
  toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
);
const ABI_CODER = AbiCoder.defaultAbiCoder();

function readConfigFile(path: string): DemoConfig {
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as DemoConfig;
}

function cachePath(owner: string): string {
  const safeOwner = owner.toLowerCase();
  return resolve(CACHE_DIR, `${safeOwner}.json`);
}

function loadRequirementsCache(): PaymentRequirements | null {
  if (!existsSync(REQUIREMENTS_CACHE_PATH)) {
    return null;
  }
  try {
    const raw = readFileSync(REQUIREMENTS_CACHE_PATH, "utf8");
    const cached = JSON.parse(raw) as PaymentRequirements;
    if (!cached.scheme || !cached.network || !cached.payTo || !cached.asset) {
      return null;
    }
    if (!cached.extra?.channelManager) {
      return null;
    }
    const expiry = cached.extra?.channelExpiry;
    if (expiry !== undefined) {
      const now = Math.floor(Date.now() / 1000);
      if (expiry <= now) {
        rmSync(REQUIREMENTS_CACHE_PATH, { force: true });
        return null;
      }
    }
    return cached;
  } catch {
    rmSync(REQUIREMENTS_CACHE_PATH, { force: true });
    return null;
  }
}

function writeRequirementsCache(requirements: PaymentRequirements): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(REQUIREMENTS_CACHE_PATH, JSON.stringify(requirements, null, 2));
}

function clearRequirementsCache(): void {
  rmSync(REQUIREMENTS_CACHE_PATH, { force: true });
}

function writeCoordinateCache(index: number, lat: number, lon: number, response: unknown): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = resolve(CACHE_DIR, `${index}.json`);
  writeFileSync(path, JSON.stringify({ index, lat, lon, response }, null, 2));
}

function writeMonacoResponse(body: unknown): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(MONACO_RESPONSE_PATH, JSON.stringify(body, null, 2));
}

function loadChannelCache(owner: string): ChannelView | null {
  const path = cachePath(owner);
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const cached = JSON.parse(raw) as Partial<ChannelView>;
    if (!cached.channelId || cached.channelId === "0x0") {
      return null;
    }
    if (cached.expiryTimestamp === undefined || cached.sequenceNumber === undefined) {
      return null;
    }
    const now = Math.floor(Date.now() / 1000);
    if (cached.expiryTimestamp <= now) {
      rmSync(path, { force: true });
      return null;
    }
    return {
      channelId: cached.channelId,
      owner: cached.owner || owner,
      balance: cached.balance || "0",
      expiryTimestamp: cached.expiryTimestamp,
      sequenceNumber: cached.sequenceNumber,
      userSignature: cached.userSignature || "",
      sequencerSignature: cached.sequencerSignature || "",
      signatureTimestamp: cached.signatureTimestamp || 0,
      recipients: cached.recipients || []
    };
  } catch {
    rmSync(path, { force: true });
    return null;
  }
}

function writeChannelCache(owner: string, channel: ChannelView): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  const path = cachePath(owner);
  writeFileSync(path, JSON.stringify(channel, null, 2));
}

function clearChannelCache(owner: string): void {
  rmSync(cachePath(owner), { force: true });
}

function resolveConfig(): ResolvedConfig {
  const configPath = process.env.DEMO_CONFIG || DEFAULT_CONFIG_PATH;
  const fileConfig = readConfigFile(configPath);

  const mnemonic = process.env.HARDHAT_MNEMONIC || fileConfig.mnemonic;
  const accountIndexValue = process.env.DEMO_ACCOUNT_INDEX || fileConfig.accountIndex?.toString() || "2";
  const accountIndex = Number(accountIndexValue);
  if (Number.isNaN(accountIndex) || accountIndex < 0) {
    throw new Error("Invalid account index");
  }

  let privateKey = process.env.DEMO_PRIVATE_KEY || fileConfig.privateKey;
  if (!privateKey && mnemonic) {
    const path = `m/44'/60'/0'/0/${accountIndex}`;
    privateKey = HDNodeWallet.fromPhrase(mnemonic, undefined, path).privateKey;
  }

  if (!privateKey) {
    throw new Error("Missing private key (set DEMO_PRIVATE_KEY or provide mnemonic in config)");
  }

  return {
    rpcUrl: process.env.RPC_URL || fileConfig.rpcUrl || "http://localhost:8545",
    serviceUrl: process.env.SERVICE_URL || fileConfig.serviceUrl || "http://localhost:4000",
    sequencerUrl: process.env.SEQUENCER_URL || "http://localhost:4001",
    privateKey,
    channelAmount: (() => {
      const value = process.env.CHANNEL_AMOUNT || fileConfig.channelAmount;
      return value ? toBigInt(value) : undefined;
    })(),
    channelExpirySeconds: Number(
      process.env.CHANNEL_EXPIRY_SECONDS || fileConfig.channelExpirySeconds || 24 * 60 * 60
    ),
    query: process.env.QUERY || fileConfig.query || "monaco",
    purpose: process.env.PURPOSE || fileConfig.purpose || "x402-demo"
  };
}

function toBigInt(value: string | number | bigint): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Invalid amount");
    }
    return BigInt(Math.trunc(value));
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`Amount must be integer string, got ${value}`);
  }
  return BigInt(value);
}

function normalizeAddress(value: string): string {
  if (!isAddress(value)) {
    throw new Error(`Invalid address: ${value}`);
  }
  return getAddress(value);
}

function channelUpdateDigest(
  domain: ChannelDomain,
  channelId: string,
  sequenceNumber: number,
  timestamp: number,
  recipients: string[],
  amounts: bigint[]
): string {
  const recipientsPacked =
    recipients.length === 0 ? "0x" : solidityPacked(recipients.map(() => "address"), recipients);
  const amountsPacked =
    amounts.length === 0 ? "0x" : solidityPacked(amounts.map(() => "uint256"), amounts);
  const recipientsHash = keccak256(recipientsPacked);
  const amountsHash = keccak256(amountsPacked);
  const structHash = keccak256(
    ABI_CODER.encode(
      ["bytes32", "bytes32", "uint256", "uint256", "bytes32", "bytes32"],
      [CHANNEL_DATA_TYPEHASH, channelId, sequenceNumber, timestamp, recipientsHash, amountsHash]
    )
  );
  const domainSeparator = keccak256(
    ABI_CODER.encode(
      ["bytes32", "bytes32", "bytes32", "uint256", "address"],
      [DOMAIN_TYPEHASH, keccak256(toUtf8Bytes(domain.name)), keccak256(toUtf8Bytes(domain.version)), domain.chainId, domain.verifyingContract]
    )
  );
  return keccak256(solidityPacked(["bytes2", "bytes32", "bytes32"], ["0x1901", domainSeparator, structHash]));
}

function signChannelUpdate(
  wallet: Wallet,
  domain: ChannelDomain,
  channelId: string,
  sequenceNumber: number,
  timestamp: number,
  recipients: string[],
  amounts: bigint[]
): string {
  const digest = channelUpdateDigest(domain, channelId, sequenceNumber, timestamp, recipients, amounts);
  return wallet.signingKey.sign(digest).serialized;
}

async function fetchJson<T>(url: string, options?: RequestInit) {
  const resp = await fetch(url, options);
  const text = await resp.text();
  const json = text ? (JSON.parse(text) as T) : null;
  return { resp, json, text };
}

async function listChannelsByOwner(sequencerUrl: string, owner: string): Promise<string[]> {
  const { resp, json } = await fetchJson<ChannelsByOwnerResponse>(
    `${sequencerUrl}/channels/by-owner/${owner}`
  );
  if (!resp.ok || !json) {
    throw new Error(`Failed to list channels (${resp.status})`);
  }
  return json.channelIds;
}

async function getChannel(sequencerUrl: string, channelId: string): Promise<ChannelView | null> {
  const { resp, json } = await fetchJson<ChannelView>(`${sequencerUrl}/channel/${channelId}`);
  if (resp.status === 404) {
    return null;
  }
  if (!resp.ok || !json) {
    throw new Error(`Failed to fetch channel (${resp.status})`);
  }
  return json;
}

async function seedChannel(sequencerUrl: string, channel: ChannelView): Promise<void> {
  const resp = await fetch(`${sequencerUrl}/channel/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channelId: channel.channelId,
      owner: channel.owner,
      balance: channel.balance,
      expiryTimestamp: channel.expiryTimestamp
    })
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Failed to seed channel (${resp.status}): ${text}`);
  }
}

function applyPayment(
  channel: ChannelView,
  receiver: string,
  amount: bigint
): { recipients: RecipientView[]; sequenceNumber: number } {
  const recipients = channel.recipients.map(recipient => ({
    recipientAddress: normalizeAddress(recipient.recipientAddress),
    balance: recipient.balance
  }));

  const normalizedReceiver = normalizeAddress(receiver);
  const existing = recipients.find(r => r.recipientAddress === normalizedReceiver);
  if (existing) {
    existing.balance = (BigInt(existing.balance) + amount).toString();
  } else {
    recipients.push({ recipientAddress: normalizedReceiver, balance: amount.toString() });
  }

  return {
    recipients,
    sequenceNumber: channel.sequenceNumber + 1
  };
}

async function ensureChannel(
  config: ResolvedConfig,
  wallet: Wallet,
  txSigner: Signer,
  chainId: number,
  channelManagerAddress: string,
  usdcAddress: string,
  channelAmount: bigint,
  expiryTimestamp: number
): Promise<ChannelView> {
  const channelManager = new Contract(channelManagerAddress, CHANNEL_ABI, txSigner);

  // 1) Look up any existing channel IDs on-chain via the sequencer's RPC helper.
  const owner = await wallet.getAddress();
  if (process.env.CACHE_ONLY) {
    const cached = loadChannelCache(owner);
    if (!cached) {
      throw new Error("Cache-only mode enabled, but no cached channel state found.");
    }
    console.log(`Cache-only mode: using cached channel ${cached.channelId}`);
    return cached;
  }
  const cached = loadChannelCache(owner);
  if (cached) {
    console.log(`Using cached channel state (skipping sequencer lookup): ${cached.channelId}`);
    return cached;
  }
  console.log("Checking sequencer for existing channels...", { owner });
  const channelIds = await listChannelsByOwner(config.sequencerUrl, owner);
  console.log(`Sequencer returned ${channelIds.length} channel(s).`);

  for (let idx = channelIds.length - 1; idx >= 0; idx -= 1) {
    const channelId = channelIds[idx];
    const existing = await getChannel(config.sequencerUrl, channelId);
    if (existing) {
      console.log(`Found existing channel in sequencer: ${channelId}`);
      return existing;
    }
    const onchain = await channelManager.channels(channelId);
    if (onchain.expiryTime > 0n) {
      console.log(`Seeding sequencer from on-chain channel: ${channelId}`);
      const seededChannel: ChannelView = {
        channelId,
        owner: normalizeAddress(onchain.owner),
        balance: onchain.balance.toString(),
        expiryTimestamp: Number(onchain.expiryTime),
        sequenceNumber: Number(onchain.sequenceNumber),
        userSignature: "",
        sequencerSignature: "",
        signatureTimestamp: 0,
        recipients: []
      };
      await seedChannel(config.sequencerUrl, seededChannel);
      const seeded = await getChannel(config.sequencerUrl, channelId);
      if (seeded) {
        console.log(`Sequencer seed confirmed for channel: ${channelId}`);
        return seeded;
      }
    }
  }

  // 2) No channel seeded yet -> open a new channel on-chain.
  console.log("No existing channel found. Opening a new channel on-chain...");
  if (channelAmount === 0n) {
    throw new Error("USDC balance is zero; cannot open a channel");
  }
  const usdc = new Contract(usdcAddress, ERC20_ABI, txSigner);
  const now = Math.floor(Date.now() / 1000);
  const expiry = expiryTimestamp;
  const channelId = (await channelManager.getChannelId(
    owner,
    expiry,
    channelAmount
  )) as string;

  const domain: ChannelDomain = {
    name: "X402CheddrPaymentChannel",
    version: "1",
    chainId,
    verifyingContract: channelManagerAddress
  };
  const userSignature = signChannelUpdate(wallet, domain, channelId, 0, now, [], []);

  // 3) Approve token spend if needed, then open the channel.
  const allowance = (await usdc.allowance(owner, channelManagerAddress)) as bigint;
  if (allowance < channelAmount) {
    console.log("Approving token spend...", {
      amount: channelAmount.toString(),
      spender: channelManagerAddress
    });
    const approveTx = await usdc.approve(channelManagerAddress, channelAmount);
    await approveTx.wait();
    console.log("Approval confirmed.");
  }

  console.log("Opening channel on-chain...", {
    channelId,
    amount: channelAmount.toString(),
    expiryTimestamp: expiry
  });
  const tx = await channelManager.openChannel(channelAmount, expiry, now, userSignature);
  await tx.wait();
  console.log(`Channel open confirmed: ${channelId}`);

  // 4) Seed the sequencer's local DB so it can validate future updates.
  const channel: ChannelView = {
    channelId,
    owner,
    balance: channelAmount.toString(),
    expiryTimestamp: expiry,
    sequenceNumber: 0,
    userSignature: "",
    sequencerSignature: "",
    signatureTimestamp: 0,
    recipients: []
  };

  console.log("Seeding sequencer for new channel...", { channelId });
  await seedChannel(config.sequencerUrl, channel);
  const seeded = await getChannel(config.sequencerUrl, channelId);
  if (!seeded) {
    throw new Error("Failed to seed channel in sequencer");
  }
  console.log(`Sequencer seed confirmed for new channel: ${channelId}`);

  return seeded;
}

async function requestRequirements(serviceUrl: string, query: string): Promise<PaymentRequirements> {
  const url = new URL("/geocode", serviceUrl);
  url.searchParams.set("query", query);
  const { resp, json, text } = await fetchJson<{ accepts?: PaymentRequirements[] }>(url.toString());
  if (resp.status !== 402) {
    throw new Error(`Expected 402 response, got ${resp.status}: ${text}`);
  }
  const requirements = json?.accepts?.[0];
  if (!requirements) {
    throw new Error("No payment requirements returned");
  }
  return requirements;
}

function writeMonacoResponseOnce(body: unknown): void {
  if (existsSync(MONACO_RESPONSE_PATH)) {
    return;
  }
  writeMonacoResponse(body);
}

async function runReverseBatch(options: {
  config: ResolvedConfig;
  owner: string;
  wallet: Wallet;
  chainId: number;
  requirements: PaymentRequirements;
  channel: ChannelView;
}): Promise<void> {
  const { config, owner, wallet, chainId, requirements } = options;
  let channel = options.channel;
  const payTo = normalizeAddress(requirements.payTo);
  const amount = toBigInt(requirements.maxAmountRequired);

  const count = Number(process.env.REVERSE_COUNT || 100);
  const startLat = Number(process.env.REVERSE_START_LAT || 43.7282151);
  const startLon = Number(process.env.REVERSE_START_LON || 7.4135342);
  const endLat = Number(process.env.REVERSE_END_LAT || 43.7457591);
  const endLon = Number(process.env.REVERSE_END_LON || 7.4344044);

  const domain: ChannelDomain = {
    name: requirements.extra?.domain?.name || "X402CheddrPaymentChannel",
    version: requirements.extra?.domain?.version || "1",
    chainId: requirements.extra?.domain?.chainId || chainId,
    verifyingContract: requirements.extra?.domain?.verifyingContract || requirements.extra!.channelManager
  };

  console.log(`Starting reverse-geocode batch (${count} requests).`);
  for (let i = 1; i <= count; i += 1) {
    const t = count <= 1 ? 0 : (i - 1) / (count - 1);
    const lat = startLat + (endLat - startLat) * t;
    const lon = startLon + (endLon - startLon) * t;
    const updated = applyPayment(channel, payTo, amount);
    const nextSequenceNumber = updated.sequenceNumber;
    const timestamp = Math.floor(Date.now() / 1000);
    const recipients = updated.recipients.map(r => r.recipientAddress);
    const amounts = updated.recipients.map(r => BigInt(r.balance));
    const userSignature = signChannelUpdate(
      wallet,
      domain,
      channel.channelId,
      nextSequenceNumber,
      timestamp,
      recipients,
      amounts
    );

    const payload: PayInChannelPayload = {
      channelId: channel.channelId,
      amount: amount.toString(),
      receiver: payTo,
      sequenceNumber: nextSequenceNumber,
      timestamp,
      userSignature,
      purpose: config.purpose
    };

    const paymentPayload = {
      x402Version: 1,
      scheme: requirements.scheme,
      network: requirements.network,
      payload
    };
    const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

    const paidUrl = new URL("/reverse", config.serviceUrl);
    paidUrl.searchParams.set("lat", lat.toString());
    paidUrl.searchParams.set("lon", lon.toString());

    const paidResponse = await fetch(paidUrl.toString(), {
      headers: {
        "X-PAYMENT": paymentHeader
      }
    });

    const responseText = await paidResponse.text();
    const statusInfo = { status: paidResponse.status, ok: paidResponse.ok };
    console.log(`Reverse ${i}/${count}:`, JSON.stringify(statusInfo));

    if (!paidResponse.ok) {
      let parsedError: unknown = responseText;
      try {
        parsedError = JSON.parse(responseText);
      } catch {
        parsedError = responseText;
      }
      console.warn("Reverse request failed. Clearing local caches.", parsedError);
      clearChannelCache(owner);
      clearRequirementsCache();
      throw new Error("Reverse batch failed due to non-OK response.");
    }

    let parsedBody: unknown = responseText;
    try {
      parsedBody = JSON.parse(responseText);
    } catch {
      parsedBody = responseText;
    }

    writeCoordinateCache(i, lat, lon, parsedBody);

    if (i === 1) {
      writeMonacoResponseOnce(parsedBody);
      console.log(`Stored initial reverse response at ${MONACO_RESPONSE_PATH}`);
    }

    channel = {
      ...channel,
      sequenceNumber: nextSequenceNumber,
      recipients: updated.recipients,
      userSignature,
      sequencerSignature: "",
      signatureTimestamp: timestamp
    };
    writeChannelCache(owner, channel);
  }

  console.log("Reverse batch complete.");
}

async function main() {
  const config = resolveConfig();
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(config.privateKey, provider);
  const txSigner = new NonceManager(wallet);
  const owner = await wallet.getAddress();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("=== Demo client ===");
  console.log(`Service URL: ${config.serviceUrl}`);
  console.log(`RPC URL: ${config.rpcUrl}`);
  console.log(`Sequencer URL: ${config.sequencerUrl}`);
  console.log(`Using account: ${owner}`);
  console.log(`Chain ID: ${chainId}`);

  // Step A) Ask the paid service for payment requirements (returns 402), unless cached.
  let requirements = loadRequirementsCache();
  if (requirements && !process.env.REQUIREMENTS_ONLY) {
    console.log("Using cached payment requirements (skipping 402 handshake).");
  } else if (requirements && process.env.REQUIREMENTS_ONLY) {
    console.log("Requirements-only mode: cached payment requirements already present.");
  } else if (!requirements) {
    if (process.env.CACHE_ONLY) {
      throw new Error("Cache-only mode enabled, but no cached payment requirements found.");
    }
    console.log("Requesting payment requirements (402)...", { query: config.query });
    requirements = await requestRequirements(config.serviceUrl, config.query);
    writeRequirementsCache(requirements);
    console.log("Cached payment requirements for /geocode.");
  }
  if (process.env.REQUIREMENTS_ONLY) {
    console.log("Requirements-only mode: cached payment requirements and exiting.");
    return;
  }
  console.log("Using requirements:", {
    scheme: requirements.scheme,
    network: requirements.network,
    payTo: requirements.payTo,
    asset: requirements.asset,
    channelManager: requirements.extra?.channelManager,
    nextSequenceNumber: requirements.extra?.nextSequenceNumber,
    channelExpiry: requirements.extra?.channelExpiry,
    channelAmount: requirements.extra?.channelAmount
  });
  const channelManagerAddress = requirements.extra?.channelManager;
  const usdcAddress = requirements.asset;

  if (!channelManagerAddress || !usdcAddress) {
    throw new Error("Missing channel manager or USDC address in 402 requirements");
  }

  const normalizedChannelManager = normalizeAddress(channelManagerAddress);
  const normalizedUsdc = normalizeAddress(usdcAddress);

  // Step B) Decide channel size (default to full USDC balance).
  const usdcRead = new Contract(normalizedUsdc, ERC20_ABI, provider);
  const balance = (await usdcRead.balanceOf(owner)) as bigint;
  const requestedAmount = config.channelAmount ?? balance;
  const channelAmount = requestedAmount > balance ? balance : requestedAmount;
  const now = Math.floor(Date.now() / 1000);
  const expiryTimestamp =
    requirements.extra?.channelExpiry && requirements.extra.channelExpiry > now
      ? requirements.extra.channelExpiry
      : now + config.channelExpirySeconds;

  console.log("Ensuring channel exists...", {
    channelAmount: channelAmount.toString(),
    balance: balance.toString(),
    expiryTimestamp
  });
  // Step C) Open + seed channel if needed (or reuse existing).
  const channel = await ensureChannel(
    config,
    wallet,
    txSigner,
    chainId,
    normalizedChannelManager,
    normalizedUsdc,
    channelAmount,
    expiryTimestamp
  );
  console.log(`Using channel ${channel.channelId} (seq=${channel.sequenceNumber})`);

  if (process.env.REVERSE_BATCH) {
    await runReverseBatch({
      config,
      owner,
      wallet,
      chainId,
      requirements,
      channel
    });
    return;
  }

  const payTo = normalizeAddress(requirements.payTo);
  const amount = toBigInt(requirements.maxAmountRequired);

  const updated = applyPayment(channel, payTo, amount);
  const nextSequenceNumber = updated.sequenceNumber;

  const timestamp = Math.floor(Date.now() / 1000);
  const domain: ChannelDomain = {
    name: requirements.extra?.domain?.name || "X402CheddrPaymentChannel",
    version: requirements.extra?.domain?.version || "1",
    chainId: requirements.extra?.domain?.chainId || chainId,
    verifyingContract: requirements.extra?.domain?.verifyingContract || normalizedChannelManager
  };
  const recipients = updated.recipients.map(r => r.recipientAddress);
  const amounts = updated.recipients.map(r => BigInt(r.balance));

  // Step E) Sign the updated channel state (EIP-712).
  const userSignature = signChannelUpdate(
    wallet,
    domain,
    channel.channelId,
    nextSequenceNumber,
    timestamp,
    recipients,
    amounts
  );

  const payload: PayInChannelPayload = {
    channelId: channel.channelId,
    amount: amount.toString(),
    receiver: payTo,
    sequenceNumber: nextSequenceNumber,
    timestamp,
    userSignature,
    purpose: config.purpose
  };

  // Step F) Submit the paid request with X-PAYMENT header.
  console.log("Submitting paid request...", {
    channelId: channel.channelId,
    sequenceNumber: nextSequenceNumber,
    amount: amount.toString(),
    receiver: payTo
  });
  const paymentPayload = {
    x402Version: 1,
    scheme: requirements.scheme,
    network: requirements.network,
    payload
  };

  const paymentHeader = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");

  const paidUrl = new URL("/geocode", config.serviceUrl);
  paidUrl.searchParams.set("query", config.query);
  const paidResponse = await fetch(paidUrl.toString(), {
    headers: {
      "X-PAYMENT": paymentHeader
    }
  });

  const responseText = await paidResponse.text();
  console.log(
    "Paid request status:",
    JSON.stringify({ status: paidResponse.status, ok: paidResponse.ok }, null, 2)
  );
  try {
    const parsed = JSON.parse(responseText);
    console.log("Paid response body:", JSON.stringify(parsed, null, 2));
    writeMonacoResponseOnce(parsed);
  } catch {
    console.log("Paid response body:", responseText);
  }

  if (paidResponse.status === 402) {
    console.warn("Payment rejected (402). Clearing local channel cache.");
    clearChannelCache(owner);
    clearRequirementsCache();
  } else if (paidResponse.ok) {
    const cachedChannel: ChannelView = {
      ...channel,
      sequenceNumber: nextSequenceNumber,
      recipients: updated.recipients,
      userSignature,
      sequencerSignature: "",
      signatureTimestamp: timestamp
    };
    writeChannelCache(owner, cachedChannel);
    console.log(`Cached channel state for ${owner}.`);
  }

  const paymentResponseHeader = paidResponse.headers.get("x-payment-response");
  if (paymentResponseHeader) {
    const decoded = Buffer.from(paymentResponseHeader, "base64").toString("utf8");
    console.log("X-PAYMENT-RESPONSE:");
    console.log(decoded);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
