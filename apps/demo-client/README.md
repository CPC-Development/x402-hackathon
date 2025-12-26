# Demo client

Run a paid request against the x402 service using a local private key.

## Setup

1. Copy `config.example.json` to `config.json` and fill in values.
2. Install deps and run:

```bash
cd x402/apps/demo-client
cp config.example.json config.json
# edit config.json

yarn install
yarn start
```

The client will:
- request payment requirements (402) from the service
- open + seed a channel if none exists
- sign a channel update
- call the paid `/geocode` endpoint

The channel manager + token addresses are discovered from the 402 requirements metadata.
