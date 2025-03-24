FROM rust:slim-bullseye as builder
WORKDIR /app
RUN apt-get update && apt-get install -y pkg-config libssl-dev

# Build actual application
COPY programs /app/programs
COPY llm_oracle /app/llm_oracle
COPY Anchor.toml Cargo.toml Cargo.lock ./
RUN cargo build --release

FROM debian:bullseye-slim
WORKDIR /app
RUN apt-get update && apt-get install -y ca-certificates libssl1.1 && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/target/release/llm_oracle /app/llm_oracle

CMD ["./llm_oracle"]
