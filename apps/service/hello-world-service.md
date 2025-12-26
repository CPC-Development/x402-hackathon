# Paid Nominatim proxy

This service exposes a small, for-pay geocoder API backed by the internal Nominatim container.
It requires x402 CPC payments on every request.

## Endpoints

- `GET /health` - readiness check
- `GET /geocode?query=<text>` - forward geocode (requires payment)
- `GET /reverse?lat=<lat>&lon=<lon>` - reverse geocode (requires payment)

The channel ID is provided inside the base64-encoded `X-PAYMENT` header payload.
For the initial 402 response (before sending a payment header), include `owner=<0x...>` so the service can look up the latest channel.
If the payment header is missing, the service returns 402 with CPC requirements.
