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
