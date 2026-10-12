#!/bin/bash
set -euo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
MTAPI_DIR=${1:-$HOME/codes/mtapi}
OUT=${2:-$DIR/target}

dotnet build "$DIR/mtprobe/mtprobe.csproj" -c Release -o "$OUT/mtprobe" -p:MtapiDir="$MTAPI_DIR" \
  -p:BaseIntermediateOutputPath="$OUT/obj/" 2>&1 | grep -E " error |Build succeeded"

dotnet publish "$DIR/mtprobe/mtprobe.csproj" -c Release -r linux-x64 --self-contained true \
  -p:PublishSingleFile=true -p:MtapiDir="$MTAPI_DIR" -p:BaseIntermediateOutputPath="$OUT/obj-pub/" \
  -o "$OUT/linux-x64" 2>&1 | grep -E " error |published" || true
echo "mac dll: $OUT/mtprobe/mtprobe.dll"
echo "linux static: $OUT/linux-x64/mtprobe"
