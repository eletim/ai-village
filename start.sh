#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$(realpath "$0")")"

if [[ $# -eq 0 && ! -v INVOCATION_ID ]] && command -v systemctl >/dev/null 2>&1 && systemctl --user is-active --quiet ai-village.service 2>/dev/null; then
  echo 'AI村は既に起動しています: http://127.0.0.1:5173'
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo 'Node.js 22以上が必要です。' >&2
  exit 1
fi

node -e 'if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Node.js 22以上が必要です。"); process.exit(1); }'

lock_hash="$(sha256sum package.json package-lock.json | sha256sum | cut -d ' ' -f 1)"
stamp=node_modules/.ai-village-deps-sha256

if [[ ! -f "$stamp" || "$(cat "$stamp")" != "$lock_hash" ]] || ! node -e 'import("sharp")' >/dev/null 2>&1; then
  if command -v npm >/dev/null 2>&1; then
    npm ci
  elif command -v pnpm >/dev/null 2>&1; then
    pnpm install --no-frozen-lockfile --lockfile=false
  else
    echo '依存パッケージの導入には npm または pnpm が必要です。' >&2
    exit 1
  fi
  printf '%s\n' "$lock_hash" > "$stamp"
fi

if [[ ! -v VILLAGE_VPN_ADDRESS ]] && command -v tailscale >/dev/null 2>&1; then
  vpn_address="$(tailscale ip -4 2>/dev/null || true)"
  if [[ "$vpn_address" =~ ^100\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    export VILLAGE_VPN_ADDRESS="$vpn_address"
  fi
fi

exec node scripts/supervise.mjs "$@"
