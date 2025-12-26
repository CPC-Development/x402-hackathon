# x402 Hackathon Checklist (Payment-Channel Demo)

Date: 2025-12-25

Status legend: [ ] todo, [x] done, [~] in progress

## Assumptions to validate (fresh ecosystem docs)
- [ ] Target protocol version is x402 v1 for the demo (v2 later if needed). This avoids v2 toolchain churn.
  - Note: v2 launched recently; many ecosystem tools still show v1 flows.
- [ ] Header names and locations for requirements/payment/response are aligned with v1 (X-PAYMENT header and v1 response shape).
  - Note: Some docs now show v2 PAYMENT-* headers; avoid mixing formats in the demo.
- [ ] Facilitator endpoints exist and are required (/verify, /settle, /supported) and match expected request shapes.
  - Sources: https://x402.gitbook.io/x402/core-concepts/client-server
  - Reference flow: https://docs.cdp.coinbase.com/x402/docs/http-402
- [ ] Default facilitator at https://x402.org/facilitator is testnet-only; mainnet needs self-hosted or external facilitator.
  - Source: https://github.com/dabit3/x402-starter-kit
- [ ] CAIP-2 network identifiers are valid inputs in tooling (e.g., eip155:84532 for Base Sepolia).
  - Source: https://github.com/dabit3/x402-starter-kit
- [ ] Ecosystem templates exist for quick scaffolding (confirm v1 compatibility):
  - create-x402 lists templates for servers, agents, MCP server, and a facilitator template. https://github.com/dabit3/create-x402
  - Scaffold-ETH x402 extension exists and includes middleware + a send request script. https://github.com/scaffold-eth/create-eth-extensions/tree/x402
  - x402 starter kit appears v2-only; avoid unless we explicitly upgrade to v2. https://github.com/dabit3/x402-starter-kit
- [ ] Notion Builder Resources page accessible and relevant. (Open if possible; earlier access returned an internal error.)
  - Source: https://www.notion.so/Builder-Resources-2bd3db1c88a78060bddfe8c03bf88c1a

## High-level plan TODOs (from repo plans)

### 1) Protocol + scheme design
- [x] Decide scheme ID for payment channel (example: v2-eip155-cheddr-channel). : let's use "v1-eip155-cpc"
- [ ] Finalize x402 PaymentRequirements.extra fields needed for channel operation:
  - channelId, nextSequenceNumber, expiry, allowedRecipients, feeDestination, settlementStrategy, domainSeparator, channelManager
- [ ] Decide header strategy: strict v1 headers only (for now).
- [ ] Choose settlement strategy default: offchain state (fast) vs onchain publish (proof).

### 2) Facilitator integration (x402-rs fork)
- [ ] Add new scheme module in x402-rs (verify/settle/supported).
- [ ] Register scheme in SchemeBlueprints::full().
- [ ] Add scheme config entry in config.json.example.
- [ ] Implement verify path:
  - Validate channel update signatures
  - Enforce amount caps vs requirements
  - Enforce replay protection (channelId + seq)
- [ ] Implement settle path:
  - Offchain settle: call sequencer (preferred for demo latency)
  - Optional onchain publish path for proof-based flows
- [ ] Expose /supported response for the new scheme/network.

### 3) Sequencer / backend
- [ ] Provide a fast verification endpoint for the facilitator to call (dry-run).
- [ ] Provide a settle endpoint that:
  - persists channel updates (idempotent)
  - returns payer + logical transaction id
  - optionally enqueues onchain publish
- [ ] Decide if facilitator calls sequencer via HTTP or direct lib.

### 4) Smart contracts (x402/contracts/hardhat/plan.md)
- [ ] Build simplified contract variant (EOA-only users; disallow smart-contract wallets).
- [ ] Deploy test USDC (usdc-test) and mint all supply to account #2 (client).
- [ ] Deploy channel manager and set roles:
  - #0 deployer
  - #1 sequencer
  - #2 client
  - #3 service

### 5) Service (paid API) (x402/apps/service/plan.md)
- [ ] Implement hello-world paid endpoint (simple calc).
- [ ] Return HTTP 402 with x402 Accepts array for channel scheme.
- [ ] Price at 0.0001 cents per call (confirm units).
- [ ] Use facilitator for verify/settle (or local verification if desired).

### 6) Client (x402/apps/demo-client/plan.md)
- [ ] TSX script client outside the docker stack.
- [ ] Reads config file with private key (account #2).
- [ ] Handles 402, selects accepts, signs channel update (EIP-712).
- [ ] Retries request with PAYMENT-SIGNATURE header.

### 7) Docker stack (x402/docs/high-level-plan.md)
- [ ] Compose services:
  - hardhat chain (similar to cpc-pos/backend/Dockerfile.hardhat)
  - facilitator (x402-rs fork)
  - sequencer
  - service (paid API)
- [ ] Provide seed script to fund accounts and deploy contracts.
- [ ] Provide environment template with chainId, RPC, token addresses.

### 8) Demo walkthrough
- [ ] Scripted demo:
  1) Start stack
  2) Run client script (one-off)
  3) Observe 402 -> pay -> 200 flow
- [ ] Show two modes:
  - offchain settle (fast)
  - onchain publish (proof)

### 9) Docs + submission
- [ ] README with architecture diagram and sequence diagram.
- [ ] Quickstart steps (1-2 commands).
- [ ] Record a short demo video / GIF.

## Ecosystem resources to reuse (validated)
- create-x402 templates include:
  - Starter kit (Express + Docker)
  - Servers (Express, Hono, mainnet)
  - Agents and MCP server
  - Facilitator template
  Source: https://github.com/dabit3/create-x402
- x402 Starter Kit:
  - v2-only; skip for now unless we decide to upgrade the demo to v2
  Source: https://github.com/dabit3/x402-starter-kit
- Scaffold-ETH x402 extension:
  - NextJS middleware for protected routes + request script
  - Uses env vars for facilitator URL, resource wallet, and network
  Source: https://github.com/scaffold-eth/create-eth-extensions/tree/x402

## Risks / open questions
- [ ] Header compatibility mismatch (v2 PAYMENT-* vs v1 X-PAYMENT).
- [ ] Scheme registration in x402-rs requires source changes; confirm we are ok maintaining a fork.
- [ ] Do we need a hosted facilitator or router for the demo (or local-only)?
- [ ] Decide whether to align with Coinbase facilitator APIs or keep Cheddr-specific verify/settle.
- [ ] If we later upgrade to v2, revisit all header names, payload shapes, and middleware.


## Optimisations
- use the sequencer as a specialized rpc
- allow the sequencer to take Cheddr as payment token to open channels
- provide dual proto/json apis on the sequencer side and use protobuf in the header format (https://chatgpt.com/c/694d947c-8058-8332-b70b-ca0a0ed8b2d3)
- update protocol to be compatible with x402 v2
- deploy to sepolia with a public instance to demo speed advantage
- make a local benchmark for TPS checks, to see how we are improving using 