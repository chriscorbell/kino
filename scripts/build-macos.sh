#!/usr/bin/env bash

set -euo pipefail

kino_repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
kino_build_dir="${KINO_MACOS_BUILD_DIR:-${kino_repo_root}/build/macos}"
kino_deployment_target="${KINO_MACOS_DEPLOYMENT_TARGET:-26.0}"
kino_qt_prefix="${KINO_QT_PREFIX:-$(brew --prefix qt)}"

"${kino_qt_prefix}/bin/qt-cmake" \
  -S "${kino_repo_root}/apps/macos-shell" \
  -B "${kino_build_dir}" \
  -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_OSX_DEPLOYMENT_TARGET="${kino_deployment_target}" \
  -DCMAKE_OSX_SYSROOT="$(xcrun --show-sdk-path)"

cmake --build "${kino_build_dir}" --parallel

echo "Built ${kino_build_dir}/Kino.app"
