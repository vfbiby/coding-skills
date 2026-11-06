#!/bin/bash
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
OUT=${1:-$HOME/.cache/brokerprobe}
export PATH=$HOME/.cargo/bin:$HOME/.local/bin:$PATH
cd "$DIR/probe"
cargo build --release --target-dir "$OUT" 2>&1 | grep -E "^error|Finished"
cargo zigbuild --release --target x86_64-unknown-linux-gnu --target-dir "$OUT" 2>&1 | grep -E "^error|Finished"
echo "local:  $OUT/release/brokerprobe"
echo "remote: $OUT/x86_64-unknown-linux-gnu/release/brokerprobe"
