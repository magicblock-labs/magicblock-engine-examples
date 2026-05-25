#!/bin/bash

VERSION="0.14.3"
PACKAGES=("ephemeral-rollups-sdk" "ephemeral-rollups-kit" "ephemeral-rollups-pinocchio")

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
  find . -name "package.json" -type f -not -path "*/node_modules/*" -not -path "*/private-payments/*" | while read -r file; do
    if grep -q "$package" "$file"; then
      # Create backup for diff
      cp "$file" "$TEMP_DIR/$(basename $file).bak"
      
      sed -i '' "s/\"@magicblock-labs\/$package\": \"[^\"]*\"/\"@magicblock-labs\/$package\": \"$VERSION\"/g" "$file"
      sed -i '' "s/\"$package\": \"[^\"]*\"/\"$package\": \"$VERSION\"/g" "$file"
      
      echo "  ✓ $file"
      UPDATED_FILES+=("$file")
    fi
  done
done

# Update Cargo.toml files
echo "Updating Cargo.toml files..."
for package in "${PACKAGES[@]}"; do
  find . -name "Cargo.toml" -type f -not -path "*/private-payments/*" | while read -r file; do
    if grep -q "$package" "$file"; then
      # Create backup for diff
      cp "$file" "$TEMP_DIR/$(basename $file).bak"
      
      sed -i '' "s/$package = { version = \"[^\"]*\"/$package = { version = \"$VERSION\"/g" "$file"
      sed -i '' "s/$package = \"[^\"]*\"/$package = \"$VERSION\"/g" "$file"
      
      echo "  ✓ $file"
      UPDATED_FILES+=("$file")
    fi
  done
done

# Update yarn.lock files
echo "Regenerating yarn.lock files..."
find . -name "package.json" -type f -not -path "*/node_modules/*" | while read -r file; do
  dir=$(dirname "$file")
  if [ -f "$dir/yarn.lock" ]; then
    if (cd "$dir" && yarn install 2>/dev/null); then
      echo "  ✓ $dir/yarn.lock"
    else
      echo "  ✗ $dir/yarn.lock (yarn install failed)"
      YARN_ERRORS+=("$dir")
    fi
  fi
done

# Regenerate Cargo.lock files
echo "Regenerating Cargo.lock files..."
find . -name "Cargo.toml" -type f | while read -r file; do
  dir=$(dirname "$file")
  if [ -f "$dir/Cargo.lock" ]; then
    if [ -f "$dir/Anchor.toml" ]; then
      build_cmd="anchor build"
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
done

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
