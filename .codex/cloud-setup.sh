#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if command -v sudo >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y \
    build-essential \
    curl \
    file \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    patchelf \
    pkg-config
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "Rust/Cargo is required. Install the stable Rust toolchain in the Codex Cloud setup conversation."
  exit 1
fi

if command -v rustup >/dev/null 2>&1; then
  rustup toolchain install stable --profile minimal
  rustup default stable
fi

cd "$repo_root/src-tauri"
cargo fetch --locked

echo "Codex Cloud dependencies are ready."
