import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
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
  purpose?: string;
};

type ResolvedConfig = {
  rpcUrl: string;
  serviceUrl: string;
  sequencerUrl: string;
  privateKey: string;
  channelAmount?: bigint;
  channelExpirySeconds: number;
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

type PaymentHeaderResult = {
  header: string;
  nextChannel: ChannelView;
  sequenceNumber: number;
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
const CHANNEL_DATA_TYPEHASH = keccak256(
  toUtf8Bytes("ChannelData(bytes32 channelId,uint256 sequenceNumber,uint256 timestamp,address[] recipients,uint256[] amounts)")
);
const DOMAIN_TYPEHASH = keccak256(
  toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")
);
const ABI_CODER = AbiCoder.defaultAbiCoder();

const DUMMY_PATH = "/dummy";
const BENCHMARK_SECONDS = Number(process.env.BENCHMARK_DURATION_SECONDS || 10);
const PRESIGN_COUNT = Number(process.env.BENCHMARK_PRESIGN_COUNT || 10000);

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
    purpose: process.env.PURPOSE || fileConfig.purpose || "x402-benchmark"
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

  const owner = await wallet.getAddress();
  const channelIds = await listChannelsByOwner(config.sequencerUrl, owner);

  for (let idx = channelIds.length - 1; idx >= 0; idx -= 1) {
    const channelId = channelIds[idx];
    const existing = await getChannel(config.sequencerUrl, channelId);
    if (existing) {
      return existing;
    }
    const onchain = await channelManager.channels(channelId);
    if (onchain.expiryTime > 0n) {
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
        return seeded;
      }
    }
  }

  if (channelAmount === 0n) {
    throw new Error("USDC balance is zero; cannot open a channel");
  }
  const usdc = new Contract(usdcAddress, ERC20_ABI, txSigner);
  const now = Math.floor(Date.now() / 1000);
  const expiry = expiryTimestamp;
  const channelId = (await channelManager.getChannelId(owner, expiry, channelAmount)) as string;

  const domain: ChannelDomain = {
    name: "X402CheddrPaymentChannel",
    version: "1",
    chainId,
    verifyingContract: channelManagerAddress
  };
  const userSignature = signChannelUpdate(wallet, domain, channelId, 0, now, [], []);

  const allowance = (await usdc.allowance(owner, channelManagerAddress)) as bigint;
  if (allowance < channelAmount) {
    const approveTx = await usdc.approve(channelManagerAddress, channelAmount);
    await approveTx.wait();
  }

  const tx = await channelManager.openChannel(channelAmount, expiry, now, userSignature);
  await tx.wait();

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

async function requestRequirements(serviceUrl: string, owner: string): Promise<PaymentRequirements> {
  const url = new URL(DUMMY_PATH, serviceUrl);
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

async function sendPaidRequest(serviceUrl: string, paymentHeader: string): Promise<void> {
  const url = new URL(DUMMY_PATH, serviceUrl);
  const resp = await fetch(url.toString(), {
    headers: {
      "X-PAYMENT": paymentHeader
    }
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Paid request failed (${resp.status}): ${text}`);
  }
}

function buildPaymentHeader(
  wallet: Wallet,
  channel: ChannelView,
  domain: ChannelDomain,
  payTo: string,
  amount: bigint,
  purpose?: string
): PaymentHeaderResult {
  const updated = applyPayment(channel, payTo, amount);
  const sequenceNumber = updated.sequenceNumber;
  const timestamp = Math.floor(Date.now() / 1000);
  const recipients = updated.recipients.map(r => r.recipientAddress);
  const amounts = updated.recipients.map(r => BigInt(r.balance));
  const userSignature = signChannelUpdate(
    wallet,
    domain,
    channel.channelId,
    sequenceNumber,
    timestamp,
    recipients,
    amounts
  );

  const payload: PayInChannelPayload = {
    channelId: channel.channelId,
    amount: amount.toString(),
    receiver: payTo,
    sequenceNumber,
    timestamp,
    userSignature,
    purpose
  };

  const paymentPayload = {
    x402Version: 1,
    scheme: "cpc",
    network: `eip155:${domain.chainId}`,
    payload
  };

  const header = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  const nextChannel: ChannelView = {
    ...channel,
    sequenceNumber,
    recipients: updated.recipients
  };

  return { header, nextChannel, sequenceNumber };
}

async function main() {
  const config = resolveConfig();
  const provider = new JsonRpcProvider(config.rpcUrl);
  const wallet = new Wallet(config.privateKey, provider);
  const txSigner = new NonceManager(wallet);
  const owner = await wallet.getAddress();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("=== Benchmark client ===");
  console.log(`Service URL: ${config.serviceUrl}`);
  console.log(`RPC URL: ${config.rpcUrl}`);
  console.log(`Sequencer URL: ${config.sequencerUrl}`);
  console.log(`Using account: ${owner}`);
  console.log(`Chain ID: ${chainId}`);
  console.log(`Benchmark window: ${BENCHMARK_SECONDS}s`);
  console.log(`Presign count: ${PRESIGN_COUNT}`);

  console.log("Requesting payment requirements (402) for /dummy...");
  let requirements = await requestRequirements(config.serviceUrl, owner);

  const channelManagerAddress = requirements.extra?.channelManager;
  const usdcAddress = requirements.asset;
  if (!channelManagerAddress || !usdcAddress) {
    throw new Error("Missing channel manager or USDC address in 402 requirements");
  }
  const normalizedChannelManager = normalizeAddress(channelManagerAddress);
  const normalizedUsdc = normalizeAddress(usdcAddress);

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

  let channel = await ensureChannel(
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

  console.log("Requesting updated requirements after channel setup...");
  requirements = await requestRequirements(config.serviceUrl, owner);

  const payTo = normalizeAddress(requirements.payTo);
  const amount = toBigInt(requirements.maxAmountRequired);
  const requirementChannelId = requirements.extra?.channelId || channel.channelId;
  const refreshed = await getChannel(config.sequencerUrl, requirementChannelId);
  if (!refreshed) {
    throw new Error(`Channel not found in sequencer: ${requirementChannelId}`);
  }
  channel = refreshed;
  const expectedNext = channel.sequenceNumber + 1;
  const reqNext = requirements.extra?.nextSequenceNumber ?? expectedNext;
  if (reqNext !== expectedNext) {
    console.warn(`Sequence mismatch (requirements=${reqNext}, local=${expectedNext}); using local state.`);
  }

  const domain: ChannelDomain = {
    name: requirements.extra?.domain?.name || "X402CheddrPaymentChannel",
    version: requirements.extra?.domain?.version || "1",
    chainId: requirements.extra?.domain?.chainId || chainId,
    verifyingContract: requirements.extra?.domain?.verifyingContract || normalizedChannelManager
  };

  console.log("Benchmarking live signing for 10 seconds...");
  const endAt = performance.now() + BENCHMARK_SECONDS * 1000;
  let count = 0;
  while (performance.now() < endAt) {
    const { header, nextChannel } = buildPaymentHeader(wallet, channel, domain, payTo, amount, config.purpose);
    await sendPaidRequest(config.serviceUrl, header);
    channel = nextChannel;
    count += 1;
  }
  const elapsedSeconds = BENCHMARK_SECONDS;
  const perSecond = count / elapsedSeconds;
  console.log(`Live signing throughput: ${count} requests in ${elapsedSeconds}s (~${perSecond.toFixed(2)} req/s)`);

  console.log(`Pre-signing ${PRESIGN_COUNT} messages...`);
  const headers: string[] = [];
  for (let i = 0; i < PRESIGN_COUNT; i += 1) {
    const { header, nextChannel } = buildPaymentHeader(wallet, channel, domain, payTo, amount, config.purpose);
    headers.push(header);
    channel = nextChannel;
  }

  console.log("Sending pre-signed requests...");
  const start = performance.now();
  for (const header of headers) {
    await sendPaidRequest(config.serviceUrl, header);
  }
  const elapsed = (performance.now() - start) / 1000;
  console.log(`Pre-signed throughput: ${PRESIGN_COUNT} requests in ${elapsed.toFixed(2)}s (~${(PRESIGN_COUNT / elapsed).toFixed(2)} req/s)`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
