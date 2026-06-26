#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 ]]; then
  cat >&2 <<'USAGE'
Usage: scripts/run-export-limited.sh <memory-gib> <nesql-export-dir> <output-dir> [export args...]

Example:
  scripts/run-export-limited.sh 10 /path/to/.minecraft/nesql/nesql-repository /tmp/gtnh-export-test --previous data/data.bin
USAGE
  exit 2
fi

memory_gib="$1"
nesql_dir="$2"
output_dir="$3"
shift 3

if ! [[ "$memory_gib" =~ ^[0-9]+$ ]] || [[ "$memory_gib" -lt 1 ]]; then
  echo "memory-gib must be a positive whole number" >&2
  exit 2
fi

gc_heap_bytes=$((memory_gib * 1024 * 1024 * 1024))
gc_heap_hex=$(printf '0x%X' "$gc_heap_bytes")

# DOTNET_GCHeapHardLimit limits the managed GC heap. Avoid ulimit -v by default:
# CoreCLR reserves virtual memory during startup and can fail before user code.
export DOTNET_GCHeapHardLimit="$gc_heap_hex"
export DOTNET_GCConserveMemory=9
if [[ "${GTNH_EXPORT_USE_ULIMIT:-0}" == "1" ]]; then
  ulimit -v $(((memory_gib + 4) * 1024 * 1024))
fi

echo "Running export with ${memory_gib} GiB .NET GC heap cap (${DOTNET_GCHeapHardLimit})"
exec dotnet run --project export/export.csproj "$nesql_dir" --output "$output_dir" "$@"
