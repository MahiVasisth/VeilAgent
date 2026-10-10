#!/usr/bin/env bash
# make demo: the whole Veil8004 demo (docs/SPEC.md "Demo script", walkthrough in docs/demo.md) from a clean Anvil.
#   deploy everything -> register agents -> start the sealed store, the mock screening API (MOCK) and the local runner
#   (SIMULATED DON: W1, W3, W2) -> scripts/src/demo.ts (six steps, each statement checked) -> serve the frontend and check
#   every page: /indexer (split view), /auction, /audit, /costs, /claims.
# Usage: make demo                 run end to end, then stop everything
#        KEEP=1 make demo          leave Anvil, the services and the pages running (for presenting)
#        PAUSE=1 KEEP=1 make demo  also wait for Enter between steps
#        SIM_CLIENTS=10 make demo  size of the SIMULATED population (default 6; the group cap is 16)
set -euo pipefail
cd "$(dirname "$0")/.."
export ANVIL_RPC_URL=${ANVIL_RPC_URL:-http://127.0.0.1:8545}
export SEALED_STORE_URL=${SEALED_STORE_URL:-http://127.0.0.1:8787}
export MOCK_SCREENING_URL=${MOCK_SCREENING_URL:-http://127.0.0.1:8788}
ANVIL_PORT=${ANVIL_RPC_URL##*:}
WEB_PORT=${WEB_PORT:-3000}
LOGS=$(mktemp -d)
export DEMO_OUT_DIR=$LOGS
PIDS=()

cleanup() {
  if [[ "${KEEP:-0}" != 1 ]]; then for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done; fi
}
trap cleanup EXIT
wait_for() { for _ in $(seq 1 150); do eval "$1" >/dev/null 2>&1 && return 0; sleep 0.2; done; echo "timed out: $1" >&2; return 1; }
step() { printf '\n==> %s\n' "$*"; }

for tool in anvil forge cast bun curl openssl; do
  command -v "$tool" >/dev/null || { echo "missing $tool; see README.md Setup" >&2; exit 1; }
done
if cast chain-id --rpc-url "$ANVIL_RPC_URL" >/dev/null 2>&1; then
  echo "something is already listening on $ANVIL_RPC_URL; stop it so the demo starts from a clean Anvil" >&2; exit 1
fi
for url in "$SEALED_STORE_URL" "$MOCK_SCREENING_URL" "http://127.0.0.1:$WEB_PORT"; do
  if curl -s -o /dev/null "$url"; then echo "$url is in use; stop it first" >&2; exit 1; fi
done

step "check the pinned Semaphore proving artifacts"
if ! bun -e 'import { snarkArtifacts, DEFAULT_DEPTHS } from "./sdk/src/snarkArtifacts.ts"; for (const d of DEFAULT_DEPTHS) snarkArtifacts(d)' 2>/dev/null; then
  echo "fetching them once (make artifacts); proving is offline after this"
  bun scripts/src/fetch-artifacts.ts
fi

step "build contracts and regenerate TypeScript ABIs"
(cd contracts && forge build --quiet)
bun scripts/src/gen-abis.ts

step "start a clean Anvil on port $ANVIL_PORT (logs: $LOGS)"
anvil --port "$ANVIL_PORT" --silent >"$LOGS/anvil.log" 2>&1 & PIDS+=($!)
wait_for "cast chain-id --rpc-url $ANVIL_RPC_URL"

step "deploy ERC-8004, Veil8004, Semaphore V4, receipts and feedback, and the MockForwarder (SIMULATION)"
DEPLOYER_KEY=$(cast wallet private-key "test test test test test test test test test test test junk" 0)
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast --private-key "$DEPLOYER_KEY" 2>&1 \
  | grep -E 'Registry|Forwarder|Hiring|Semaphore|Receipt|Feedback|Treasury|written')

step "register 3 agents (Atlas, Borealis, Cirrus; fictional)"
(cd contracts && forge script script/RegisterAgents.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast 2>&1 | grep -E '^\s+agent ')

step "generate throwaway secrets for this run (never written to the repo)"
eval "$(bun -e 'import { generateKeyPair } from "./sdk/src/seal.ts"; const a = generateKeyPair(), b = generateKeyPair(); console.log(`export W1_PUBLIC_KEY=${a.publicKey} W1_DECRYPT_KEY=${a.secretKey} W3_PUBLIC_KEY=${b.publicKey} W3_DECRYPT_KEY=${b.secretKey}`)')"
export SEALED_STORE_W1_TOKEN=$(openssl rand -hex 32)
export SEALED_STORE_W3_TOKEN=$(openssl rand -hex 32)
export SCREENING_API_KEY=$(openssl rand -hex 32)

step "start the sealed store, the mock screening API (MOCK) and the local runner (SIMULATED DON: W1, W3, W2)"
bun services/sealed-store/src/main.ts >"$LOGS/sealed-store.log" 2>&1 & PIDS+=($!)
bun services/mock-screening/src/main.ts >"$LOGS/mock-screening.log" 2>&1 & PIDS+=($!)
wait_for "curl -sf $SEALED_STORE_URL/health"
wait_for "curl -sf $MOCK_SCREENING_URL/health"
RUNNER_FROM_BLOCK=$(cast block-number --rpc-url "$ANVIL_RPC_URL") bun cre/local-runner/src/main.ts >"$LOGS/runner.log" 2>&1 & PIDS+=($!)
wait_for "grep -q JobCompleted $LOGS/runner.log"

# Build the frontend while the demo runs; it only reads the chain at request time.
(cd frontend && bun run build >"$LOGS/next-build.log" 2>&1; echo $? >"$LOGS/next-build.status") & BUILD_PID=$!

step "THE DEMO"
bun scripts/src/demo.ts

step "the pages: /indexer, /auction, /audit, /costs, /claims"
wait "$BUILD_PID" || true
[[ "$(cat "$LOGS/next-build.status")" == 0 ]] || { cat "$LOGS/next-build.log"; exit 1; }
(cd frontend && exec bunx next start --port "$WEB_PORT" >"$LOGS/next.log" 2>&1) & PIDS+=($!)
wait_for "curl -sf -o /dev/null http://127.0.0.1:$WEB_PORT/indexer"
problems=()
page() { curl -sf "http://127.0.0.1:$WEB_PORT/$1" || problems+=("/$1 does not render"); }
INDEXER=$(page indexer); AUCTION=$(page auction); AUDIT=$(page audit); COSTS=$(page costs); CLAIMS=$(page claims)
for want in 'data-testid="veil-view"' 'data-testid="anon-rating"' 'data-testid="sim-data-banner"'; do
  grep -qF -- "$want" <<<"$INDEXER" || problems+=("/indexer missing: $want")
done
grep -qF 'data-testid="sim-task"' <<<"$AUCTION" || problems+=("/auction does not label the simulated tasks")
grep -qF 'data-testid="sim-data-banner"' <<<"$AUCTION" || problems+=("/auction has no simulated-data banner")
grep -qF 'Selective disclosure' <<<"$AUDIT" || problems+=("/audit missing its heading")
for want in 'data-testid="cost-row"' 'Anonymous rating' 'Sealed bid' 'Attestation: request'; do
  grep -qF -- "$want" <<<"$COSTS" || problems+=("/costs missing: $want")
done
[[ $(grep -o 'data-testid="claim-row"' <<<"$CLAIMS" | wc -l) -ge 22 ]] || problems+=("/claims shows fewer than 22 claims")
# The pages must not show a losing price (the demo's are distinctive).
for p in 4217.35 3904.12; do grep -qF "$p" <<<"$INDEXER$AUCTION$COSTS" && problems+=("a losing price ($p) is on a page"); done
if ((${#problems[@]})); then printf 'PAGE CHECK FAILED:\n  %s\n' "${problems[@]}" >&2; exit 1; fi
echo "PAGE CHECK PASSED: split view, auction (simulated tasks labeled), audit, costs and claims all render"

printf '\nDemo complete.\n'
if [[ "${KEEP:-0}" == 1 ]]; then
  echo "Everything is still running (pids ${PIDS[*]}). Open http://127.0.0.1:$WEB_PORT/indexer"
  # Public keys only (the decryption keys stay in the runner's memory): enough for bidder.ts, client.ts and make simulate.
  printf 'export W1_PUBLIC_KEY=%s W3_PUBLIC_KEY=%s\n' "$W1_PUBLIC_KEY" "$W3_PUBLIC_KEY" >"$LOGS/public-keys.env"
  echo "The audit bundle from step 4 is at $LOGS/bundle.json (paste it into /audit)."
  echo "To add simulated clients or use the CLIs: source $LOGS/public-keys.env && make simulate CLIENTS=4"
  echo "Stop with: kill ${PIDS[*]}"
fi
