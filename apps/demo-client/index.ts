import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Contract,
  HDNodeWallet,
  JsonRpcProvider,
  NonceManager,
  Signer,
  Wallet,
  getAddress,
  isAddress
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

const CHANNEL_ABI = [
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

function readConfigFile(path: string): DemoConfig {
  if (!existsSync(path)) {
    return {};
  }
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as DemoConfig;
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
  // 1) Look up any existing channel IDs on-chain via the sequencer's RPC helper.
  const owner = await wallet.getAddress();
  const channelIds = await listChannelsByOwner(config.sequencerUrl, owner);

  for (let idx = channelIds.length - 1; idx >= 0; idx -= 1) {
    const existing = await getChannel(config.sequencerUrl, channelIds[idx]);
    if (existing) {
      return existing;
    }
  }

  // 2) No channel seeded yet -> open a new channel on-chain.
  const channelManager = new Contract(channelManagerAddress, CHANNEL_ABI, txSigner);
  const usdc = new Contract(usdcAddress, ERC20_ABI, txSigner);
  const now = Math.floor(Date.now() / 1000);
  const expiry = expiryTimestamp;
  const channelId = (await channelManager.getChannelId(
    owner,
    expiry,
    channelAmount
  )) as string;

  const domain = {
    name: "X402CheddrPaymentChannel",
    version: "1",
    chainId,
    verifyingContract: channelManagerAddress
  };
  const types = {
    ChannelData: [
      { name: "channelId", type: "bytes32" },
      { name: "sequenceNumber", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" }
    ]
  };
  const message = {
    channelId,
    sequenceNumber: 0,
    timestamp: now,
    recipients: [] as string[],
    amounts: [] as bigint[]
  };

  const userSignature = await wallet.signTypedData(domain, types, message);

  // 3) Approve token spend if needed, then open the channel.
  const allowance = (await usdc.allowance(owner, channelManagerAddress)) as bigint;
  if (allowance < channelAmount) {
    const approveTx = await usdc.approve(channelManagerAddress, channelAmount);
    await approveTx.wait();
  }

  const tx = await channelManager.openChannel(channelAmount, expiry, now, userSignature);
  await tx.wait();

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

  await seedChannel(config.sequencerUrl, channel);
  const seeded = await getChannel(config.sequencerUrl, channelId);
  if (!seeded) {
    throw new Error("Failed to seed channel in sequencer");
  }

  return seeded;
}

async function requestRequirements(
  serviceUrl: string,
  owner: string,
  query: string
): Promise<PaymentRequirements> {
  const url = new URL("/geocode", serviceUrl);
  url.searchParams.set("query", query);
  url.searchParams.set("owner", owner);
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

  // Step A) Ask the paid service for payment requirements (returns 402).
  console.log("Requesting payment requirements (402)...", { query: config.query });
  let requirements = await requestRequirements(config.serviceUrl, owner, config.query);
  console.log("Received requirements:", {
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
  if (channelAmount === 0n) {
    throw new Error("USDC balance is zero; cannot open a channel");
  }
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

  // Step D) Re-fetch requirements to get the real channelId + nextSequenceNumber.
  console.log("Requesting updated requirements after channel setup...");
  requirements = await requestRequirements(config.serviceUrl, owner, config.query);
  console.log("Updated requirements:", {
    nextSequenceNumber: requirements.extra?.nextSequenceNumber,
    channelId: requirements.extra?.channelId
  });
  const payTo = normalizeAddress(requirements.payTo);
  const amount = toBigInt(requirements.maxAmountRequired);

  const updated = applyPayment(channel, payTo, amount);
  const nextSequenceNumber = requirements.extra?.nextSequenceNumber ?? updated.sequenceNumber;
  if (nextSequenceNumber !== updated.sequenceNumber) {
    throw new Error(`Sequence mismatch (requirements=${nextSequenceNumber}, local=${updated.sequenceNumber})`);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const domain = {
    name: requirements.extra?.domain?.name || "X402CheddrPaymentChannel",
    version: requirements.extra?.domain?.version || "1",
    chainId: requirements.extra?.domain?.chainId || chainId,
    verifyingContract: requirements.extra?.domain?.verifyingContract || normalizedChannelManager
  };
  const types = {
    ChannelData: [
      { name: "channelId", type: "bytes32" },
      { name: "sequenceNumber", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "recipients", type: "address[]" },
      { name: "amounts", type: "uint256[]" }
    ]
  };
  const message = {
    channelId: channel.channelId,
    sequenceNumber: nextSequenceNumber,
    timestamp,
    recipients: updated.recipients.map(r => r.recipientAddress),
    amounts: updated.recipients.map(r => BigInt(r.balance))
  };

  // Step E) Sign the updated channel state (EIP-712).
  const userSignature = await wallet.signTypedData(domain, types, message);

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
  console.log(`Paid request status: ${paidResponse.status}`);
  console.log(responseText);

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
