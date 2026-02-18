#!/bin/bash
# McpHub install script
set -e

INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"

echo "Building McpHub (release)..."
cargo build --release

echo "Installing binary..."
cp target/release/McpHub "$INSTALL_DIR/McpHub"
codesign --force --sign - "$INSTALL_DIR/McpHub"

echo "✓ McpHub installed to $INSTALL_DIR/McpHub"
echo ""
echo "Generating cache..."
"$INSTALL_DIR/McpHub" generate

echo ""
echo "Done. Restart Cursor to pick up the new binary."
