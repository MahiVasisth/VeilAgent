#!/usr/bin/env bash
# Phase 1 exit criterion, end to end from a clean Anvil:
#   deploy fresh ERC-8004 registries -> register 3 agents -> plain public flow (pay, request, validate, rate)
#   -> CLI indexer check -> the "what an indexer sees" page must show client, agent, score and validation.
# Usage: make phase1        (KEEP=1 make phase1 leaves Anvil and the page running at http://127.0.0.1:3000/indexer)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
export ANVIL_RPC_URL=${ANVIL_RPC_URL:-http://127.0.0.1:8545}
ANVIL_PORT=${ANVIL_RPC_URL##*:}
WEB_PORT=${WEB_PORT:-3000}
LOGS=$(mktemp -d)
PIDS=()

cleanup() {
  if [[ "${KEEP:-0}" != 1 ]]; then for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done; fi
}
trap cleanup EXIT
wait_for() { for _ in $(seq 1 150); do eval "$1" >/dev/null 2>&1 && return 0; sleep 0.2; done; echo "timed out: $1" >&2; return 1; }
step() { printf '\n==> %s\n' "$*"; }

if cast chain-id --rpc-url "$ANVIL_RPC_URL" >/dev/null 2>&1; then
  echo "something is already listening on $ANVIL_RPC_URL; stop it so this run starts from a clean Anvil" >&2; exit 1
fi
if curl -s -o /dev/null "http://127.0.0.1:$WEB_PORT"; then
  echo "port $WEB_PORT is in use; stop it or set WEB_PORT" >&2; exit 1
fi

step "build contracts and regenerate TypeScript ABIs"
(cd contracts && forge build --quiet)
bun scripts/src/gen-abis.ts

step "start a clean Anvil on port $ANVIL_PORT (logs: $LOGS/anvil.log)"
anvil --port "$ANVIL_PORT" --silent >"$LOGS/anvil.log" 2>&1 & PIDS+=($!)
wait_for "cast chain-id --rpc-url $ANVIL_RPC_URL"

step "deploy fresh Identity, Reputation and Validation registries"
DEPLOYER_KEY=$(cast wallet private-key "test test test test test test test test test test test junk" 0)
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast --private-key "$DEPLOYER_KEY" 2>&1 \
  | grep -E 'Registry|written')

step "register 3 agents"
(cd contracts && forge script script/RegisterAgents.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast 2>&1 | grep -E '^\s+agent ')

step "plain ERC-8004 flow: pay, request validation, validate, rate"
bun scripts/src/baseline.ts

step "indexer (CLI): rebuild the graph from public data"
bun scripts/src/indexer.ts --check

step "indexer (page): build and serve the frontend, then fetch /indexer"
(cd frontend && bun run build >"$LOGS/next-build.log" 2>&1) || { cat "$LOGS/next-build.log"; exit 1; }
(cd frontend && exec bunx next start --port "$WEB_PORT" >"$LOGS/next.log" 2>&1) & PIDS+=($!)
wait_for "curl -sf -o /dev/null http://127.0.0.1:$WEB_PORT/indexer"
PAGE=$(curl -s "http://127.0.0.1:$WEB_PORT/indexer")

# The page must show the leaked graph: client, agent, score and validation (input + result).
missing=()
for want in 'data-testid="leak-graph"' '0x15d3' '0x9965' 'Atlas' 'Borealis' 'score 90' 'score 60' \
            'Northwind Trading LLC' 'Kestrel Shipping Co' 'SANCTIONS_SCREEN_V1: pass' 'SANCTIONS_SCREEN_V1: fail' \
            '0.05 ETH' '0.08 ETH'; do
  grep -qF -- "$want" <<<"$PAGE" || missing+=("$want")
done
if ((${#missing[@]})); then
  printf 'PAGE CHECK FAILED, missing: %s\n' "${missing[*]}" >&2; exit 1
fi
echo "PAGE CHECK PASSED: http://127.0.0.1:$WEB_PORT/indexer shows clients, agents, scores, payments and validation inputs/results"

printf '\nPhase 1 exit criterion met.\n'
if [[ "${KEEP:-0}" == 1 ]]; then
  echo "Anvil and the page are still running (pids ${PIDS[*]}). Open http://127.0.0.1:$WEB_PORT/indexer"
fi
