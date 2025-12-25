# Protocol + Scheme Design

Date: 2025-12-25
Scope: Hackathon demo (x402 v1 now, consider v2 later).

### 1) Protocol + scheme design
- [x] Decide scheme ID for payment channel (example: v2-eip155-cheddr-channel): use `v1-eip155-cpc`
- [x] Target protocol version for demo: x402 v1 (avoid v2 toolchain churn)
- [ ] Finalize x402 PaymentRequirements.extra fields needed for channel operation:
  - channelId, nextSequenceNumber, expiry, allowedRecipients, feeDestination, settlementStrategy, domainSeparator, channelManager
- [ ] Decide header strategy: strict v1 headers only (X-PAYMENT + v1 response shape)
- [ ] Choose settlement strategy default: offchain state (fast) vs onchain publish (proof)
- [ ] Confirm naming convention: scheme describes channel; token is specified via `asset` in payment requirements

### 2) Reference flow (x402 sequence as it relates to on-chain payments)
1. Client calls `GET /api`.
2. Server responds `402 Payment Required`.
3. Client selects payment method and creates the payment payload.
4. Client retries request with `X-PAYMENT: <b64 payload>` header.
5. Server calls facilitator `/verify`.
6. Facilitator returns verification result to server.
7. Server does work to fulfill the request.
8. Server calls facilitator `/settle`.
9. Facilitator submits tx with signature to USDC contract on chain.
10. Blockchain confirms the transaction.
11. Facilitator returns `settled` to server.
12. Server returns response with `X-PAYMENT-RESPONSE`.

Notes:
- Added latency is approximately one block time.
- Server can choose not to await the `settled` response from facilitator to reduce end-user latency
  (extra latency in that case is only the facilitator API round trip).

### 3) CPC-based first-payment flow
1. Client discovers the hello-world service and receives an x402 `402` response with the CPC scheme.
2. Client checks the sequencer for existing channel state.
3. If no channel exists, client opens one directly via `X402CheddrPaymentChannel.openChannel` using its own RPC.
4. With `channelId`, client sends the x-payment request using `PayInChannelDto`.
5. Server submits the payload to facilitator for signature validation only (no balance increase yet, no sequencer co-sign).
6. Server performs the work and then calls `settle` (todo: rename `pay-in-channel` to `settle`).
7. Sequencer updates its local DB and returns immediately with a co-signed message (or error).
8. Facilitator forwards the co-signed message via `settled` to the server. Here the sequencer provides the full channel state receipt so the server may close the channel manually if needed.

### 4) CPC-based subsequent payments (single client per address, local cache)
Goal: minimize roundtrips; client trusts its local channel cache and only re-syncs on errors.

1. Client calls the service; server responds `402` with CPC scheme (unless the request already includes `X-PAYMENT`).
2. Client uses local cache to compute the next sequence and build `PayInChannelDto`.
3. Client retries with `X-PAYMENT: <b64 payload>`; no preflight calls.
4. Server submits payload to facilitator for signature and sequence validation only.
5. Server performs the work and calls `settle`.
6. Sequencer updates local DB, returns co-signed message (or error).
7. Facilitator forwards `settled` to server; server returns response with `X-PAYMENT-RESPONSE`.

Error handling / re-sync:
- If facilitator or sequencer rejects (stale sequence, expired channel, insufficient capacity), client re-fetches
  `/channels/by-owner/{owner}` and `/channel/{id}` to reconcile and retry.
- If channel is missing/expired, client re-opens a channel and retries as a first payment.
