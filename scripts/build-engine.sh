#!/usr/bin/env bash
#
# Vendors the pinned stream-server revision, applies Kino's patches, and builds
# the kino-stream-engine helper. The helper is optional: without it Kino runs
# normally and reports torrent sources as unavailable.

set -euo pipefail

kino_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kino_engine_dir="${kino_repo_root}/apps/stream-engine"
kino_vendor_dir="${kino_repo_root}/build/vendor/stream-server"
kino_target_dir="${kino_repo_root}/build/engine-target"

# shellcheck source=/dev/null
source "${kino_engine_dir}/engine.lock"

if ! command -v cargo >/dev/null; then
  echo "Rust is required to build the streaming engine: brew install rust" >&2
  exit 1
fi
if ! pkg-config --exists libtorrent-rasterbar; then
  echo "libtorrent-rasterbar is required: brew install libtorrent-rasterbar boost" >&2
  exit 1
fi

if [[ ! -d "${kino_vendor_dir}/.git" ]]; then
  echo "Vendoring stream-server ${KINO_ENGINE_REVISION}"
  rm -rf "${kino_vendor_dir}"
  mkdir -p "$(dirname "${kino_vendor_dir}")"
  git init --quiet "${kino_vendor_dir}"
  git -C "${kino_vendor_dir}" remote add origin "${KINO_ENGINE_REPOSITORY}"
fi

if [[ "$(git -C "${kino_vendor_dir}" rev-parse HEAD 2>/dev/null || true)" != "${KINO_ENGINE_REVISION}" ]]; then
  git -C "${kino_vendor_dir}" fetch --quiet --depth 1 origin "${KINO_ENGINE_REVISION}"
  git -C "${kino_vendor_dir}" checkout --quiet --force "${KINO_ENGINE_REVISION}"
  git -C "${kino_vendor_dir}" clean --quiet -fd
  for patch in "${kino_engine_dir}"/patches/*.patch; do
    echo "Applying $(basename "${patch}")"
    git -C "${kino_vendor_dir}" apply "${patch}"
  done
fi

CXXFLAGS="${CXXFLAGS:-} -I$(brew --prefix)/include" \
  CARGO_TARGET_DIR="${kino_target_dir}" \
  cargo build --release --manifest-path "${kino_engine_dir}/Cargo.toml"

echo "Built ${kino_target_dir}/release/kino-stream-engine"
