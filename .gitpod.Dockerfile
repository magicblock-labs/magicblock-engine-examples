# anchor-counter/.gitpod.Dockerfile
FROM gitpod/workspace-full

# Install Solana CLI
RUN sh -c "$(curl -sSfL https://release.anza.xyz/v2.2.1/install)" && \
    echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> /home/gitpod/.bashrc

ENV PATH="/home/gitpod/.local/share/solana/install/active_release/bin:${PATH}"

# Pre-install Node.js global packages (optional optimization)
RUN npm install -g @coral-xyz/anchor-cli