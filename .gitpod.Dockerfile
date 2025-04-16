# anchor-counter/.gitpod.Dockerfile
FROM gitpod/workspace-full

# Install Solana CLI
RUN sh -c "$(curl -sSfL https://release.solana.com/stable/install)" && \
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> /home/gitpod/.bashrc

ENV PATH="/home/gitpod/.local/share/solana/install/active_release/bin:${PATH}"

# System dependencies (optional: still useful for Rust crates or tooling)
RUN apt-get update && \
    apt-get install -y pkg-config libssl-dev libudev-dev curl

# Pre-install Node.js global packages (optional optimization)
RUN npm install -g @coral-xyz/anchor-cli