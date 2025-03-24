FROM rust:latest AS builder
WORKDIR /app
COPY src ./src
COPY Cargo.toml Cargo.lock ./
RUN cargo build --release

FROM debian:bookworm-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && \
    apt-get clean && rm -rf /var/lib/apt/lists/* \

WORKDIR /app

COPY --from=builder /app/target/release/ephemeral-pricing-oracle /usr/local/bin

# Start the application
CMD ["sh", "-c", "/usr/local/bin/ephemeral-pricing-oracle"]