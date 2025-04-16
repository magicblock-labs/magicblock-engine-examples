# anchor-counter/.gitpod.Dockerfile
FROM gitpod/workspace-full

# Install Solana CLI
RUN sh -c "$(curl -sSfL https://release.anza.xyz/v2.2.2/install)" && \
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> /home/gitpod/.bashrc

RUN rustup update

ENV PATH="/home/gitpod/.local/share/solana/install/active_release/bin:${PATH}"

# Pre-install Node.js global packages (optional optimization)
RUN cargo install --git https://github.com/coral-xyz/anchor avm --force && avm install 0.30.1 && avm use 0.30.1