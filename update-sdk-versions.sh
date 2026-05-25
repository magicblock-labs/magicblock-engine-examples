#!/bin/bash

VERSION="0.14.3"
PACKAGES=("ephemeral-rollups-sdk" "ephemeral-rollups-kit" "ephemeral-rollups-pinocchio")
MIN_NODE_VERSION="20.19.0"

# Preflight: enforce minimum Node version
require_node_version() {
  local required="$1"
  local current
  current=$(node -v 2>/dev/null | sed 's/^v//')
  if [ -z "$current" ]; then
    echo "ERROR: node is not installed or not on PATH"
    exit 1
  fi
  # Sort -V puts versions in order; if required wins the sort, current is older
  if [ "$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -n1)" != "$required" ]; then
    echo "ERROR: node $current is older than required $required"
    echo "  If you use nvm: nvm install $required && nvm use $required"
    echo "  Or set NVM_DIR and source ~/.nvm/nvm.sh, then re-run this script."
    exit 1
  fi
  echo "Node $current (>= $required required) ✓"
}
require_node_version "$MIN_NODE_VERSION"

# Report tracking arrays
UPDATED_FILES=()
FAILED_UPDATES=()
WARNINGS=()
YARN_ERRORS=()
CARGO_ERRORS=()

# Temporary files for tracking changes
TEMP_DIR=$(mktemp -d)
trap "rm -rf $TEMP_DIR" EXIT

echo "========================================"
echo "SDK Version Update Script"
echo "========================================"
echo "Target Version: $VERSION"
echo "Target Packages: ${PACKAGES[@]}"
echo ""

# Update package.json files
echo "Updating package.json files..."
for package in "${PACKAGES[@]}"; do
  while read -r file; do
    if grep -q "$package" "$file"; then
      # Create backup for diff
      cp "$file" "$TEMP_DIR/$(basename $file).bak"

      sed -i '' "s/\"@magicblock-labs\/$package\": \"[^\"]*\"/\"@magicblock-labs\/$package\": \"$VERSION\"/g" "$file"
      sed -i '' "s/\"$package\": \"[^\"]*\"/\"$package\": \"$VERSION\"/g" "$file"

      echo "  ✓ $file"
      UPDATED_FILES+=("$file")
    fi
  done < <(find . -name "package.json" -type f -not -path "*/node_modules/*" -not -path "*/private-payments/*")
done

# Update Cargo.toml files
echo "Updating Cargo.toml files..."
for package in "${PACKAGES[@]}"; do
  while read -r file; do
    if grep -q "$package" "$file"; then
      # Create backup for diff
      cp "$file" "$TEMP_DIR/$(basename $file).bak"

      sed -i '' "s/$package = { version = \"[^\"]*\"/$package = { version = \"$VERSION\"/g" "$file"
      sed -i '' "s/$package = \"[^\"]*\"/$package = \"$VERSION\"/g" "$file"

      echo "  ✓ $file"
      UPDATED_FILES+=("$file")
    fi
  done < <(find . -name "Cargo.toml" -type f -not -path "*/private-payments/*")
done

# Update yarn.lock files
echo "Regenerating yarn.lock files..."
while read -r file; do
  dir=$(dirname "$file")
  if [ -f "$dir/yarn.lock" ]; then
    if (cd "$dir" && yarn install 2>/dev/null); then
      echo "  ✓ $dir/yarn.lock"
    else
      echo "  ✗ $dir/yarn.lock (yarn install failed)"
      YARN_ERRORS+=("$dir")
    fi
  fi
done < <(find . -name "package.json" -type f -not -path "*/node_modules/*")

# Regenerate Cargo.lock files
echo "Regenerating Cargo.lock files..."
while read -r file; do
  dir=$(dirname "$file")
  if [ -f "$dir/Cargo.lock" ]; then
    if [ -f "$dir/Anchor.toml" ]; then
      if [[ "$dir" == *"00-LEGACY_EXAMPLES"* ]]; then
        build_cmd="anchor build"
      else
        build_cmd="anchor build --ignore-keys"
      fi
    else
      build_cmd="cargo build-sbf"
    fi
    if (cd "$dir" && $build_cmd 2>/dev/null); then
      echo "  ✓ $dir/Cargo.lock ($build_cmd)"
    else
      echo "  ✗ $dir/Cargo.lock ($build_cmd failed)"
      CARGO_ERRORS+=("$dir")
    fi
  fi
done < <(find . -name "Cargo.toml" -type f)

# Generate summary report
echo ""
echo "========================================"
echo "UPDATE SUMMARY REPORT"
echo "========================================"
echo ""

echo "Files Updated: ${#UPDATED_FILES[@]}"
if [ ${#UPDATED_FILES[@]} -gt 0 ]; then
  for file in "${UPDATED_FILES[@]}"; do
    echo "  • $file"
  done
fi
echo ""

echo "Yarn Lock Issues: ${#YARN_ERRORS[@]}"
if [ ${#YARN_ERRORS[@]} -gt 0 ]; then
  for dir in "${YARN_ERRORS[@]}"; do
    echo "  ✗ $dir"
  done
else
  echo "  None"
fi
echo ""

echo "Cargo Lock Issues: ${#CARGO_ERRORS[@]}"
if [ ${#CARGO_ERRORS[@]} -gt 0 ]; then
  for dir in "${CARGO_ERRORS[@]}"; do
    echo "  ✗ $dir"
  done
else
  echo "  None"
fi
echo ""

if [ ${#YARN_ERRORS[@]} -eq 0 ] && [ ${#CARGO_ERRORS[@]} -eq 0 ]; then
  echo "Status: ✓ COMPLETED SUCCESSFULLY"
  exit 0
else
  echo "Status: ⚠ COMPLETED WITH ERRORS"
  exit 1
fi
