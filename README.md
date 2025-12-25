# x402 Hackathon Monorepo

CPC payment-channel demo using x402 v1. This repo is structured to be handed off as a self-contained monorepo.

## Layout

- `apps/service` - Paid API demo (returns 402 + CPC scheme)
- `apps/sequencer` - Sequencer service (off-chain channel updates)
- `apps/demo-client` - One-off TSX client script
- `packages/cpc-x402-sdk` - Client helpers (signing + payload helpers)
- `contracts/hardhat` - CPC contract plan + local chain scaffolding
- `facilitator/x402-rs` - x402-rs fork as a git submodule
- `docs` - Protocol notes, schema spec, hackathon checklist
- `infra` - Docker compose + env templates
- `scripts` - Seed/run/demo helpers

## Facilitator fork (submodule)

`facilitator/x402-rs` is a git submodule pointing to the fork:
- `origin`: git@github.com:apetersson/x402-rs.git
- `upstream`: https://github.com/x402-rs/x402-rs.git

Rebase workflow:

```bash
cd facilitator/x402-rs
git fetch upstream
git rebase upstream/main
```

Keep CPC changes isolated to a new scheme module and a small registration change so upstream PRs are clean.

## Quickstart (placeholder)

```bash
# pull submodules
cd x402
git submodule update --init --recursive

# bring up infra (partial while TODOs are pending)
cd infra
docker compose --profile facilitator up
```

## Demo flow (target)

1. Start stack: hardhat + facilitator + sequencer + paid service
2. Run `apps/demo-client` TSX script
3. Observe 402 -> pay -> 200

## Current scheme

- Scheme ID: `v1-eip155-cpc`
- Spec: `docs/x402-eip155-cpc-schema.md`
