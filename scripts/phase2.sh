#!/usr/bin/env bash
# Phase 2 exit criterion, end to end from a clean Anvil:
#   deploy (ERC-8004 + Veil8004 core + TreasuryAction + MockForwarder) -> register agents -> Phase 1 public baseline
#   -> start the sealed store, the mock screening API and the local runner (SIMULATED DON)
#   -> scripts/src/phase2.ts: gate passes and fails as specified; chain shows only commitment, policy and result
#   -> the indexer page shows the split view, with no plaintext input on the Veil8004 side.
# Usage: make phase2        (KEEP=1 make phase2 leaves everything running at http://127.0.0.1:3000/indexer)
set -euo pipefail
cd "$(dirname "$0")/.."
export ANVIL_RPC_URL=${ANVIL_RPC_URL:-http://127.0.0.1:8545}
export SEALED_STORE_URL=${SEALED_STORE_URL:-http://127.0.0.1:8787}
export MOCK_SCREENING_URL=${MOCK_SCREENING_URL:-http://127.0.0.1:8788}
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
for url in "$SEALED_STORE_URL" "$MOCK_SCREENING_URL" "http://127.0.0.1:$WEB_PORT"; do
  if curl -s -o /dev/null "$url"; then echo "$url is in use; stop it first" >&2; exit 1; fi
done

step "build contracts and regenerate TypeScript ABIs"
(cd contracts && forge build --quiet)
bun scripts/src/gen-abis.ts

step "start a clean Anvil on port $ANVIL_PORT (logs: $LOGS)"
anvil --port "$ANVIL_PORT" --silent >"$LOGS/anvil.log" 2>&1 & PIDS+=($!)
wait_for "cast chain-id --rpc-url $ANVIL_RPC_URL"

step "deploy ERC-8004 registries, Veil8004 core, TreasuryAction and the MockForwarder (SIMULATION)"
DEPLOYER_KEY=$(cast wallet private-key "test test test test test test test test test test test junk" 0)
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast --private-key "$DEPLOYER_KEY" 2>&1 \
  | grep -E 'Registry|Forwarder|Treasury|written')

step "register 3 agents and run the Phase 1 public baseline (the 'before' side of the split view)"
(cd contracts && forge script script/RegisterAgents.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast 2>&1 | grep -E '^\s+agent ')
bun scripts/src/baseline.ts >/dev/null

step "generate throwaway secrets for this run (never written to the repo)"
eval "$(bun -e 'import { generateKeyPair } from "./sdk/src/seal.ts"; const k = generateKeyPair(); console.log(`export W1_PUBLIC_KEY=${k.publicKey} W1_DECRYPT_KEY=${k.secretKey}`)')"
export SEALED_STORE_W1_TOKEN=$(openssl rand -hex 32)
export SCREENING_API_KEY=$(openssl rand -hex 32)
echo "W1 public key $W1_PUBLIC_KEY (secret key, store token and API key kept in this shell only)"

step "start the sealed store, the mock screening API (MOCK) and the local runner (SIMULATED DON)"
bun services/sealed-store/src/main.ts >"$LOGS/sealed-store.log" 2>&1 & PIDS+=($!)
bun services/mock-screening/src/main.ts >"$LOGS/mock-screening.log" 2>&1 & PIDS+=($!)
wait_for "curl -sf $SEALED_STORE_URL/health"
wait_for "curl -sf $MOCK_SCREENING_URL/health"
RUNNER_FROM_BLOCK=$(cast block-number --rpc-url "$ANVIL_RPC_URL") bun cre/local-runner/src/main.ts >"$LOGS/runner.log" 2>&1 & PIDS+=($!)
wait_for "grep -q watching $LOGS/runner.log"

step "Phase 2 flow: gate passes and fails, then what the chain shows"
bun scripts/src/phase2.ts

step "local runner log (SIMULATED DON)"
sed 's/^/  /' "$LOGS/runner.log"
grep -q "commitment mismatch" "$LOGS/runner.log" || { echo "expected the runner to stop on the tampered input" >&2; exit 1; }
for f in runner sealed-store mock-screening; do
  if grep -qE 'Northwind|Kestrel|Harbor Light' "$LOGS/$f.log"; then echo "plaintext input found in $f log" >&2; exit 1; fi
done
echo "service logs checked: no plaintext input in the runner, sealed-store or screening logs"

step "indexer (page): build and serve the frontend, then fetch /indexer"
(cd frontend && bun run build >"$LOGS/next-build.log" 2>&1) || { cat "$LOGS/next-build.log"; exit 1; }
(cd frontend && exec bunx next start --port "$WEB_PORT" >"$LOGS/next.log" 2>&1) & PIDS+=($!)
wait_for "curl -sf -o /dev/null http://127.0.0.1:$WEB_PORT/indexer"
PAGE=$(curl -s "http://127.0.0.1:$WEB_PORT/indexer")
VEIL=$(python3 -c 'import sys; p=sys.stdin.read(); i=p.find("data-testid=\"veil-view\""); print(p[i:p.find("</section>", i)] if i >= 0 else "")' <<<"$PAGE")
PLAIN=$(python3 -c 'import sys; p=sys.stdin.read(); i=p.find("data-testid=\"plain-view\""); print(p[i:p.find("data-testid=\"veil-view\"", i)] if i >= 0 else "")' <<<"$PAGE")

problems=()
[[ -n "$VEIL" ]] || problems+=("no veil-view section")
grep -qF 'Northwind Trading LLC' <<<"$PLAIN" || problems+=("plain side should show the baseline input")
[[ $(grep -o 'data-testid="veil-row"' <<<"$VEIL" | wc -l) -ge 7 ]] || problems+=("expected >= 7 Veil8004 rows")
for want in 'SANCTIONS_SCREEN_V1' 'pass' 'fail' 'pending' 'the validation input (only a salted commitment is on-chain)' 'data-testid="sim-banner"'; do
  grep -qF -- "$want" <<<"$PAGE" || problems+=("missing: $want")
done
for leak in 'Northwind' 'Kestrel' 'Harbor Light'; do
  if grep -qF "$leak" <<<"$VEIL"; then problems+=("plaintext '$leak' on the Veil8004 side"); fi
done
if ((${#problems[@]})); then printf 'PAGE CHECK FAILED: %s\n' "${problems[*]}" >&2; exit 1; fi
echo "PAGE CHECK PASSED: split view shows plain inputs on the left, only commitment, policy and result on the right"

printf '\nPhase 2 exit criterion met.\n'
if [[ "${KEEP:-0}" == 1 ]]; then
  echo "Everything is still running (pids ${PIDS[*]}). Open http://127.0.0.1:$WEB_PORT/indexer"
fi
