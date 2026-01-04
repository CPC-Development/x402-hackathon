# x402 Hackathon Checklist (Payment-Channel Demo)

Date: 2025-12-25

Status legend: [ ] todo, [x] done, [~] in progress

## High-level plan TODOs (from repo plans)

### 1) Protocol + scheme design
- [x] Decide scheme ID for payment channel: v1-eip155-cpc.
- [x] Finalize x402 PaymentRequirements.extra fields for channel operation:
  - channelId, nextSequenceNumber, channelExpiry, channelManager, domain, timestampSkewSeconds, maxRecipients, feeDestinationAddress (optional)
- [x] Decide header strategy: strict v1 headers only (X-PAYMENT + v1 response shape).
- [x] Choose settlement strategy default: offchain via sequencer (fast demo latency).

### 2) Facilitator integration (x402-rs fork)
- [x] Add new scheme module in x402-rs (verify/settle/supported).
- [x] Register scheme in SchemeBlueprints::full().
- [x] Add scheme config entry in infra/facilitator-config.json.
- [x] Implement verify path:
  - Validate channel update signatures
  - Enforce amount caps vs requirements
  - Enforce replay protection (channelId + seq)
- [x] Implement settle path:
  - Offchain settle: call sequencer (preferred for demo latency)
- [x] Expose /supported response for the new scheme/network.

### 3) Sequencer / backend
- [x] Provide a fast verification endpoint for the facilitator to call (dry-run).
- [x] Provide a settle endpoint that:
  - persists channel updates (idempotent)
  - returns updated channel state for the facilitator
- [x] Decide if facilitator calls sequencer via HTTP or direct lib. (HTTP)

### 4) Smart contracts (x402/contracts/hardhat/plan.md)
- [x] Build simplified contract variant (EOA-only users; disallow smart-contract wallets).
- [x] Deploy test USDC (usdc-test) and mint all supply to account #2 (client).
- [x] Deploy channel manager with sequencer address (account #1); set pay-to address via env for service.

### 5) Service (paid API) (x402/apps/service/plan.md)
- [x] Implement paid Nominatim geocoder proxy (+ /dummy ping).
- [x] Return HTTP 402 with x402 Accepts array for channel scheme.
- [x] Price configurable via env (default 1 USDC; /dummy uses micro-price).
- [x] Use facilitator for verify/settle.

### 6) Client (x402/apps/demo-client/plan.md)
- [x] TSX script client outside the docker stack.
- [x] Reads config file with private key (account #2).
- [x] Handles 402, selects accepts, signs channel update (EIP-712).
- [x] Retries request with X-PAYMENT header.

### 7) Docker stack (x402/docs/high-level-plan.md)
- [x] Compose services:
  - hardhat chain
  - postgres (sequencer state)
  - sequencer
  - facilitator (x402-rs fork)
  - service (paid API)
  - nominatim (geocoder)
- [x] Provide seed script to fund accounts and deploy contracts.
- [x] Provide environment template with chainId, RPC, token addresses.

### 8) Demo walkthrough
- [~] Scripted demo:
  1) Start stack
  2) Run client script (one-off)
  3) Observe 402 -> pay -> 200 flow

### 9) Docs + submission
- [ ] README with architecture diagram and sequence diagram.
- [~] Quickstart steps (1-2 commands).
- [ ] Record a short demo video / GIF.

## Risks / open questions
- [x] Header compatibility mismatch (v2 PAYMENT-* vs v1 X-PAYMENT).
- [x] Scheme registration in x402-rs requires source changes; confirm we are ok maintaining a fork.
- [x] Do we need a hosted facilitator or router for the demo (or local-only)? (Local-only)
- [x] Decide whether to align with Coinbase facilitator APIs or keep Cheddr-specific verify/settle.



## Followups 
- use the sequencer as a specialized rpc
- allow the sequencer to take Cheddr as payment token to open channels
- provide dual proto/json apis on the sequencer side and use protobuf in the header format (https://chatgpt.com/c/694d947c-8058-8332-b70b-ca0a0ed8b2d3)
- update protocol to be compatible with x402 v2
- deploy to sepolia with a public instance to demo speed advantage
- make a local benchmark for TPS checks, to see how we are improving using
- test integration of cpc scheme with generic x402 curl wrappers etc.
- publish client package to npm to make it easy for implementers to ship it.
- submit PRs to @x402/fetch  and @x402/axios
- on client side security parameters max money spent
- make the sequencer open 2 UDP ports one for verify (1 second reservation), one for settle.