#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find "$repo_root/frontend" -type f -name '*.js' -print0 |
  while IFS= read -r -d '' file; do
    node --check "$file"
  done

node "$repo_root/tools/test-controls.cjs"
node "$repo_root/tools/test-save-safety.cjs"

cd "$repo_root/src-tauri"
cargo check --locked

echo "Cloud-compatible checks passed."
