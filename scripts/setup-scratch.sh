#!/bin/sh
# Optional local runtime build. Run from the repository root; no sudo or host configuration changes.
set -eu
scratch_root="${1:-$PWD/.runtime/scratch-tools}"
mkdir -p "$scratch_root"
scratch_root="$(cd "$scratch_root" && pwd)"
python3 -m pip install --target "$scratch_root/python" 'Pillow==12.3.0'
python3 -m pip install --target "$scratch_root/build-tools" 'meson==1.12.1' 'ninja==1.13.2'
if [ ! -d "$scratch_root/bubblewrap" ]; then
  git clone --branch v0.11.0 --depth 1 https://github.com/containers/bubblewrap.git "$scratch_root/bubblewrap"
fi
[ "$(git -C "$scratch_root/bubblewrap" rev-parse HEAD)" = 9ca3b05ec787acfb4b17bed37db5719fa777834f ]
if [ ! -f "$scratch_root/bubblewrap/build/build.ninja" ]; then
PYTHONPATH="$scratch_root/build-tools" PATH="$scratch_root/build-tools/bin:$PATH" python3 -m mesonbuild.mesonmain setup "$scratch_root/bubblewrap/build" "$scratch_root/bubblewrap" -Dman=disabled -Dtests=false
fi
PYTHONPATH="$scratch_root/build-tools" PATH="$scratch_root/build-tools/bin:$PATH" python3 -m mesonbuild.mesonmain compile -C "$scratch_root/bubblewrap/build"
printf 'VILLAGE_SCRATCH_RUNTIME=%s/python\nVILLAGE_SCRATCH_BWRAP=%s/bubblewrap/build/bwrap\n' "$scratch_root" "$scratch_root"
