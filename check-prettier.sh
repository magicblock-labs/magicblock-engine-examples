#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

YARN_MUTEX="${YARN_MUTEX:-file:/tmp/.yarn-install-mutex}"
FIX=0
FAILED=()
CHECKED=()

usage() {
  cat <<EOF
Usage: $(basename "$0") [--fix]

  Check Prettier formatting in all examples (default).

Options:
  --fix  Run yarn lint:fix in each example instead of yarn lint.
EOF
}

for arg in "$@"; do
  case "$arg" in
    --fix)
      FIX=1
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ "$FIX" = "1" ]; then
  LINT_SCRIPT="lint:fix"
else
  LINT_SCRIPT="lint"
fi

has_prettier_lint_script() {
  local pkg="$1"
  grep -q '"lint".*prettier' "$pkg" 2>/dev/null
}

ensure_dependencies() {
  if [ -f yarn.lock ]; then
    yarn install --mutex "$YARN_MUTEX"
  elif [ -f package-lock.json ]; then
    npm ci
  else
    yarn install --mutex "$YARN_MUTEX"
  fi
}

run_yarn_lint() {
  local dir="$1"
  local rel="${dir#./}"

  echo "yarn $LINT_SCRIPT: $rel"
  if (
    cd "$dir"
    ensure_dependencies
    yarn "$LINT_SCRIPT"
  ); then
    CHECKED+=("$rel")
  else
    FAILED+=("$rel")
  fi
}

while IFS= read -r pkg; do
  has_prettier_lint_script "$pkg" || continue
  run_yarn_lint "$(dirname "$pkg")"
done < <(
  find . -name package.json \
    -not -path '*/node_modules/*' \
    -not -path './00-LEGACY_EXAMPLES/*' \
    | sort
)

echo ""
echo "========================================"
if [ "$FIX" = "1" ]; then
  echo "Prettier Fix Summary"
else
  echo "Prettier Check Summary"
fi
echo "========================================"
if [ "$FIX" = "1" ]; then
  echo "Fixed:  ${#CHECKED[@]}"
else
  echo "Checked: ${#CHECKED[@]}"
fi
echo "Failed:  ${#FAILED[@]}"

if [ "${#FAILED[@]}" -gt 0 ]; then
  echo ""
  if [ "$FIX" = "1" ]; then
    echo "Prettier fix failed in:"
  else
    echo "Formatting check failed in:"
  fi
  for dir in "${FAILED[@]}"; do
    echo "  - $dir"
  done
  echo ""
  if [ "$FIX" = "1" ]; then
    echo "Run 'yarn lint:fix' in the failing example."
  else
    echo "Run 'bash check-prettier.sh --fix' or 'yarn lint:fix' in the failing example."
  fi
  exit 1
fi

echo ""
if [ "$FIX" = "1" ]; then
  echo "All examples formatted."
else
  echo "All examples are formatted correctly."
fi
