FROM rust:1.88-bullseye AS builder

WORKDIR /app

COPY Cargo.toml ./
COPY src ./src

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/target/release/cpc-sequencer /app/cpc-sequencer

ENV RUST_LOG=info

EXPOSE 4001

CMD ["/app/cpc-sequencer"]
