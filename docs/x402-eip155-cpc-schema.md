# x402-eip155-cpc Schema Specification (v1)

Status: Draft for hackathon demo
Scheme ID: `v1-eip155-cpc`
Scheme name: `cpc`
Namespace: `eip155`

This scheme maps Cheddr payment-channel updates to the x402 v1 payment envelope.
It is derived from:
- Sequencer DTOs and validation logic in `cpc-pos/backend/src/modules/sequencer/`
- On-chain data model and signature verification adapted from `github-cpc-contracts/HardHat-New/contracts/CheddrChannelManager.sol`
- Client-side signing flow in `cpc-user/src/libs/hooks/usePaymentChannelUpdate.ts` and helpers
- Hardhat helper signer in `github-cpc-contracts/HardHat-New/test/utils/safeTestHelpers.ts`

## 1) x402 v1 Envelope Types

### 1.1 PaymentRequirements (x402 v1)
Base shape (per x402 v1 in `x402/facilitator/x402-rs/src/proto/v1.rs`):

```json
{
  "scheme": "cpc",
  "network": "eip155:<chainId>",
  "maxAmountRequired": "<uint256 string>",
  "resource": "<string>",
  "description": "<string>",
  "mimeType": "<string>",
  "outputSchema": { "optional": true },
  "payTo": "0x<address>",
  "maxTimeoutSeconds": 900,
  "asset": "0x<tokenAddress>",
  "extra": { "...": "see below" }
}
```

### 1.2 PaymentPayload (x402 v1)

```json
{
  "x402Version": 1,
  "scheme": "cpc",
  "network": "eip155:<chainId>",
  "payload": { "...": "see PayInChannelPayload below" }
}
```

## 2) CPC Scheme: PaymentRequirements.extra

`extra` fields provide channel metadata required to build and validate a channel update.

```json
{
  "channelId": "0x<bytes32>",
  "nextSequenceNumber": 1,
  "channelExpiry": 1710000000,
  "channelManager": "0x<x402CheddrPaymentChannelAddress>",
  "domain": {
    "name": "X402CheddrPaymentChannel",
    "version": "1",
    "chainId": 84532,
    "verifyingContract": "0x<x402CheddrPaymentChannelAddress>"
  },
  "timestampSkewSeconds": 900,
  "maxRecipients": 30,
  "feeDestinationAddress": "0x<address>",
  "notes": "optional human description"
}
```

Field notes:
- `channelId`: matches on-chain `getChannelId(owner, expiryTime, amount)`:
  - `keccak256(abi.encodePacked(owner, expiryTime, amount, domainSeparator))`
- `domain`: must match EIP-712 domain used in X402CheddrPaymentChannel:
  - name: "X402CheddrPaymentChannel"
  - version: "1"
  - chainId: network chain ID
  - verifyingContract: X402CheddrPaymentChannel address
- `nextSequenceNumber`: expected sequence for the next update (sequencer enforces `current + 1`).
- `timestampSkewSeconds`: X402CheddrPaymentChannel requires signature timestamp not too far in the future
  (15 minutes used on-chain).
- `maxRecipients`: sequencer default max recipients (configurable).
- `feeDestinationAddress`: optional; if present, client may include `feeForPayment` in payload.

## 3) CPC Scheme: PaymentPayload.payload (PayInChannelPayload)

Derived from `PayInChannelDto` in `cpc-pos/backend/src/modules/sequencer/dto/channel.dto.ts`.

```json
{
  "channelId": "0x<bytes32>",
  "amount": "<uint256 string in curds>",
  "receiver": "0x<recipientAddress>",
  "sequenceNumber": 1,
  "timestamp": 1710000000,
  "userSignature": "0x<signature>",
  "purpose": "ORDER:<id>",
  "feeForPayment": {
    "feeAmountCurds": "<uint256 string>",
    "feeDestinationAddress": "0x<address>"
  }
}
```

Field notes:
- `amount` and `feeAmountCurds` are in "curds" (uint256 string) as used in backend.
- `sequenceNumber` must equal current channel sequence + 1.
- `timestamp` is UNIX seconds; must be <= channel expiry and not too far in the future.
- `userSignature` is EIP-712 signature over ChannelData (see below).
- `purpose` is optional metadata for downstream categorization.
- `feeForPayment` is optional and only valid if the fee destination is configured.

## 4) ChannelData (EIP-712 signed payload)

The signed message is constructed from the full recipient/balance state after applying the payment:

```ts
// EIP-712 domain
{
  name: "X402CheddrPaymentChannel",
  version: "1",
  chainId: <chainId>,
  verifyingContract: <channelManager>
}

// EIP-712 types
ChannelData: [
  { name: "channelId", type: "bytes32" },
  { name: "sequenceNumber", type: "uint256" },
  { name: "timestamp", type: "uint256" },
  { name: "recipients", type: "address[]" },
  { name: "amounts", type: "uint256[]" }
]

// Message
{
  channelId,
  sequenceNumber,
  timestamp,
  recipients,
  amounts
}
```

Client implementation references:
- `cpc-user/src/libs/hooks/message-to-sign-for-channel-update.ts`
- `github-cpc-contracts/HardHat-New/test/utils/safeTestHelpers.ts`

Sequencer reconstructs `recipients` and `amounts` using current channel state + the new payment
(`cpc-user/src/libs/payments/channelUpdateBuilder.ts` and
`cpc-pos/backend/src/modules/sequencer/payment.service.ts`).

## 5) Validation Rules (Server/Facilitator)

Based on `PaymentService.processPayInChannel` and X402CheddrPaymentChannel:
- Channel must exist and be open.
- `amount` > 0.
- `sequenceNumber` must equal `channel.sequenceNumber + 1`.
- Total balances after update must not exceed channel balance.
- Recipients length must be <= `SEQUENCER_MAX_RECIPIENTS` (default 30).
- Signature must be valid for:
  - EOA or ERC-1271 (off-chain)
  - SignatureVerifier and X402CheddrPaymentChannel (on-chain)
- Signature timestamp checks:
  - Not too far in the future (15-minute skew allowed).
  - Must be <= channel expiry.

## 6) Example 402 Response (Accepts)

```json
{
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "cpc",
      "network": "eip155:84532",
      "maxAmountRequired": "100",
      "resource": "/api/paid",
      "description": "Cheddr payment channel (CPC)",
      "mimeType": "application/json",
      "payTo": "0x<serviceAddress>",
      "maxTimeoutSeconds": 900,
      "asset": "0x<usdcTestAddress>",
      "extra": {
        "channelId": "0x<bytes32>",
        "nextSequenceNumber": 7,
        "channelExpiry": 1710000000,
        "channelManager": "0x<x402CheddrPaymentChannelAddress>",
        "domain": {
          "name": "X402CheddrPaymentChannel",
          "version": "1",
          "chainId": 84532,
          "verifyingContract": "0x<x402CheddrPaymentChannelAddress>"
        },
        "timestampSkewSeconds": 900,
        "maxRecipients": 30
      }
    }
  ],
  "x402Version": 1
}
```

## 7) Example PaymentPayload (X-PAYMENT)

```json
{
  "x402Version": 1,
  "scheme": "cpc",
  "network": "eip155:84532",
  "payload": {
    "channelId": "0x<bytes32>",
    "amount": "100",
    "receiver": "0x<serviceAddress>",
    "sequenceNumber": 7,
    "timestamp": 1710000000,
    "userSignature": "0x<signature>",
    "purpose": "ORDER:demo-1"
  }
}
```

## 8) Implementation Notes

- The facilitator or resource server should call the sequencer to verify/settle this payload.
- Sequencer will compute recipient balances and generate the sequencer signature.
- On-chain publish (optional) uses `publishIntermediateChannelState` and needs both user + sequencer signatures.
- Opening a channel requires an EOA signature over an empty state (sequenceNumber = 0, recipients = [], amounts = [])
  with a timestamp that is not in the future and not after the channel expiry.
