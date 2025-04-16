# anchor-counter/.gitpod.Dockerfile
FROM gitpod/workspace-full

# Install Solana and Anchor
RUN curl --proto '=https' --tlsv1.2 -sSfL https://solana-install.solana.workers.dev | bash