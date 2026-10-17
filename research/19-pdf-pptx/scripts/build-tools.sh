#!/usr/bin/env bash
# #19 research: builds the svg2pdf tools into research/19-pdf-pptx/.tools
# (gitignored). Needs rustup (stable) and, for the WASM build, the
# wasm32-unknown-unknown target. Nothing is installed system-wide.
#
#   bash research/19-pdf-pptx/scripts/build-tools.sh
#
# 1. svg2pdf 0.13.0 from crates.io (sha256-pinned), patched for byte-identical
#    output (svg2pdf-poc/svg2pdf-deterministic.patch: font objects and resource
#    dictionaries were written in HashMap order).
# 2. svg2pdf-poc: native `sumi-svg2pdf` and `sumi_svg2pdf_poc.wasm`.
# 3. The official svg2pdf-cli 0.13.0 (unpatched, system fonts) for comparison.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="$HERE/.tools"
CRATE_SHA256=e50dc062439cc1a396181059c80932a6e6bd731b130e674c597c0c8874b6df22
mkdir -p "$TOOLS/bin"

# rustup's proxies are enough for cargo/rustc; some rustup installs miss the
# rpath to libLLVM for rust-lld (wasm linking), hence the fallback path.
TOOLCHAIN="$(rustup run stable rustc --print sysroot)"
export PATH="$TOOLCHAIN/bin:$PATH"
export DYLD_FALLBACK_LIBRARY_PATH="$TOOLCHAIN/lib"
export CARGO_TARGET_DIR="$TOOLS/target"

if [ ! -d "$TOOLS/svg2pdf-0.13.0" ]; then
  curl -sSfL -o "$TOOLS/svg2pdf-0.13.0.crate" https://static.crates.io/crates/svg2pdf/svg2pdf-0.13.0.crate
  echo "$CRATE_SHA256  $TOOLS/svg2pdf-0.13.0.crate" | shasum -a 256 -c -
  tar -xzf "$TOOLS/svg2pdf-0.13.0.crate" -C "$TOOLS"
  patch -d "$TOOLS/svg2pdf-0.13.0" -p1 < "$HERE/svg2pdf-poc/svg2pdf-deterministic.patch"
fi

cargo build --release --locked --manifest-path "$HERE/svg2pdf-poc/Cargo.toml"
cp "$TOOLS/target/release/sumi-svg2pdf" "$TOOLS/bin/"
strip "$TOOLS/bin/sumi-svg2pdf" 2>/dev/null || true

if rustup target list --installed --toolchain stable | grep -q wasm32-unknown-unknown; then
  cargo build --release --locked --lib --target wasm32-unknown-unknown \
    --manifest-path "$HERE/svg2pdf-poc/Cargo.toml"
  cp "$TOOLS/target/wasm32-unknown-unknown/release/sumi_svg2pdf_poc.wasm" "$TOOLS/"
else
  echo "skip WASM: rustup target add wasm32-unknown-unknown" >&2
fi

if [ ! -x "$TOOLS/bin/svg2pdf" ]; then
  cargo install svg2pdf-cli --version 0.13.0 --locked --root "$TOOLS"
fi
ls -l "$TOOLS/bin" "$TOOLS"/*.wasm
