# anchor-counter/.gitpod.Dockerfile
FROM gitpod/workspace-full

# Setup development environment with newer GLIBC
RUN apt-get update && apt-get install -y libudev-dev

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Solana CLI
RUN sh -c "$(curl -sSfL https://release.anza.xyz/v2.2.1/install)" && \
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> /home/gitpod/.bashrc

ENV PATH="/home/gitpod/.local/share/solana/install/active_release/bin:${PATH}"

# Pre-install Node.js global packages (optional optimization)
RUN cargo install --git https://github.com/coral-xyz/anchor avm --force && avm install latest && avm use latest