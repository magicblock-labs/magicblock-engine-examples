#!/usr/bin/env bash
#
# The local MagicBlock cluster (mb-test-validator + ephemeral-validator) loads
# the ephemeral SPL token program ("e-token", SPLxh...) from the ephemeral-validator
# npm package's `local-dumps/`. That bundled build is NOT the version this
# reproduction targets (commit c7e9fff, which passes `None` for the magic fee
# vault). This script swaps the c7e9fff build (tests/fixtures/ephemeral_token_program.so)
# into that local-dumps slot so `yarn setup` / `yarn test:local` load it.
#
# Usage:
#   ./scripts/load-etoken.sh          # swap in the c7e9fff e-token (backs up the original)
#   ./scripts/load-etoken.sh restore  # restore the original bundled e-token
#
# Run this BEFORE `yarn setup`, then restart the validators.
set -euo pipefail

ETOKEN_ID="SPLxh1LVZzEkX99H6rqYizhytLWPZVV296zyYDPagv2"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURE="$HERE/tests/fixtures/ephemeral_token_program.so"

DUMP="$(command -v ephemeral-validator >/dev/null 2>&1 \
  && dirname "$(readlink -f "$(command -v ephemeral-validator)" 2>/dev/null || command -v ephemeral-validator)")"
# Resolve the npm package local-dumps dir (works for nvm/global installs).
DUMP_SO="$(ls "$(dirname "$(command -v ephemeral-validator)")"/../lib/node_modules/@magicblock-labs/ephemeral-validator/bin/local-dumps/${ETOKEN_ID}.so 2>/dev/null \
  || ls ~/.nvm/versions/node/*/lib/node_modules/@magicblock-labs/ephemeral-validator/bin/local-dumps/${ETOKEN_ID}.so 2>/dev/null \
  || true)"

if [ -z "$DUMP_SO" ] || [ ! -f "$DUMP_SO" ]; then
  echo "ERROR: could not find the ephemeral-validator local-dumps for $ETOKEN_ID." >&2
  echo "       Locate it and copy $FIXTURE over it manually." >&2
  exit 1
fi
BACKUP="$DUMP_SO.orig-backup"

if [ "${1:-}" = "restore" ]; then
  if [ -f "$BACKUP" ]; then
    cp "$BACKUP" "$DUMP_SO"
    echo "Restored original e-token: $DUMP_SO"
  else
    echo "No backup found at $BACKUP; nothing to restore."
  fi
  exit 0
fi

[ -f "$BACKUP" ] || cp "$DUMP_SO" "$BACKUP"
cp "$FIXTURE" "$DUMP_SO"
echo "Loaded c7e9fff e-token into: $DUMP_SO"
echo "Backup of the original at:   $BACKUP"
echo "Now (re)start the validators (yarn setup) and run yarn test:local."
