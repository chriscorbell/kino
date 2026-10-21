# A bare cmake --parallel runs make with no job limit

Read when: writing or running a `cmake --build` command, or a native build on CI or the Mac suddenly takes many times longer.
Status: verified
Scope: CMake builds with the Makefile generator, in scripts, workflows and by hand
Verified: 2026-10-21
Source: #229; `scripts/build-macos.sh`; `.github/workflows/ci.yml` step "Match build parallelism to the runner"; `cmake --build` help text, CMake 4.4.4
Recheck when: the desktop build moves to another CMake generator, or `ci.yml` stops setting `CMAKE_BUILD_PARALLEL_LEVEL`.

`cmake --build <dir> --parallel` with no count uses the native tool's default, which for make is `make -j` with no limit, and `CMAKE_BUILD_PARALLEL_LEVEL` applies only when `--parallel` is absent. On 2026-09-25 that ran dozens of compilers on the three-core macOS runner, pushed the load to 50 to 80, and stretched a two-minute compile to between 14 and 26 minutes, so every packaging run hit the 45-minute limit (#229). Always give a count. `scripts/build-macos.sh` passes `CMAKE_BUILD_PARALLEL_LEVEL`, or the processor count when that is unset; the macOS job sets it to the runner's cores, capped at 4. Every other `cmake --build` in `scripts/` and the workflows passes a count too. Checked on 2026-10-21 with `rg -- --parallel` over the repository and CMake's own help text.
