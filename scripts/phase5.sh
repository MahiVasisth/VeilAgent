#!/usr/bin/env bash
# Phase 5 exit criterion, end to end from a clean Anvil:
#   deploy (ERC-8004 + Veil8004 core + consumers + our Semaphore V4 + receipts + feedback + MockForwarder) -> register agents
#   -> start the sealed store, the mock screening API and the local runner (SIMULATED DON: W1, W3 and W2)
#   -> scripts/src/phase5.ts: three clients with Semaphore identities hire through sealed bids, W2 issues receipts,
#      clients rate anonymously, a second rating in the same epoch is rejected, no receipt is issued without a
#      completed awarded job, and the anchored average is read from the ERC-8004 Reputation Registry.
#   -> the indexer page's ratings split shows each anonymous rating as "one of N", the per-epoch averages and anchors.
# Usage: make phase5        (KEEP=1 make phase5 leaves everything running at http://127.0.0.1:3000/indexer)
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

step "check the pinned Semaphore proving artifacts (fetch once with: make artifacts)"
bun -e 'import { snarkArtifacts, DEFAULT_DEPTHS } from "./sdk/src/snarkArtifacts.ts"; for (const d of DEFAULT_DEPTHS) snarkArtifacts(d); console.log("artifacts present and match their pins")'

step "build contracts and regenerate TypeScript ABIs"
(cd contracts && forge build --quiet)
bun scripts/src/gen-abis.ts

step "start a clean Anvil on port $ANVIL_PORT (logs: $LOGS)"
anvil --port "$ANVIL_PORT" --silent >"$LOGS/anvil.log" 2>&1 & PIDS+=($!)
wait_for "cast chain-id --rpc-url $ANVIL_RPC_URL"

step "deploy ERC-8004 registries, Veil8004, Semaphore V4, receipts and feedback, and the MockForwarder (SIMULATION)"
DEPLOYER_KEY=$(cast wallet private-key "test test test test test test test test test test test junk" 0)
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast --private-key "$DEPLOYER_KEY" 2>&1 \
  | grep -E 'Registry|Forwarder|Hiring|Semaphore|Receipt|Feedback|written')

step "register 3 agents"
(cd contracts && forge script script/RegisterAgents.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast 2>&1 | grep -E '^\s+agent ')

step "generate throwaway secrets for this run (never written to the repo)"
eval "$(bun -e 'import { generateKeyPair } from "./sdk/src/seal.ts"; const a = generateKeyPair(), b = generateKeyPair(); console.log(`export W1_PUBLIC_KEY=${a.publicKey} W1_DECRYPT_KEY=${a.secretKey} W3_PUBLIC_KEY=${b.publicKey} W3_DECRYPT_KEY=${b.secretKey}`)')"
export SEALED_STORE_W1_TOKEN=$(openssl rand -hex 32)
export SEALED_STORE_W3_TOKEN=$(openssl rand -hex 32)
export SCREENING_API_KEY=$(openssl rand -hex 32)

step "start the sealed store, the mock screening API (MOCK) and the local runner (SIMULATED DON, W1 + W3 + W2)"
bun services/sealed-store/src/main.ts >"$LOGS/sealed-store.log" 2>&1 & PIDS+=($!)
bun services/mock-screening/src/main.ts >"$LOGS/mock-screening.log" 2>&1 & PIDS+=($!)
wait_for "curl -sf $SEALED_STORE_URL/health"
wait_for "curl -sf $MOCK_SCREENING_URL/health"
RUNNER_FROM_BLOCK=$(cast block-number --rpc-url "$ANVIL_RPC_URL") bun cre/local-runner/src/main.ts >"$LOGS/runner.log" 2>&1 & PIDS+=($!)
wait_for "grep -q JobCompleted $LOGS/runner.log"

step "Phase 5 flow: receipts and anonymous feedback"
bun scripts/src/phase5.ts

step "local runner log (SIMULATED DON)"
sed 's/^/  /' "$LOGS/runner.log"
[[ $(grep -c "receipt delivered" "$LOGS/runner.log") -eq 3 ]] || { echo "expected W2 to deliver exactly 3 receipts" >&2; exit 1; }
grep -q "no identity commitment, no receipt" "$LOGS/runner.log" || { echo "expected W2 to skip the task with no identity commitment" >&2; exit 1; }
echo "runner log checked: 3 receipts delivered, the commitment-0 task skipped"

step "indexer view (page): build and serve the frontend, then fetch /indexer"
(cd frontend && bun run build >"$LOGS/next-build.log" 2>&1) || { cat "$LOGS/next-build.log"; exit 1; }
(cd frontend && exec bunx next start --port "$WEB_PORT" >"$LOGS/next.log" 2>&1) & PIDS+=($!)
wait_for "curl -sf -o /dev/null http://127.0.0.1:$WEB_PORT/indexer"
PAGE=$(curl -s "http://127.0.0.1:$WEB_PORT/indexer")
problems=()
[[ $(grep -o 'data-testid="anon-rating"' <<<"$PAGE" | wc -l) -eq 4 ]] || problems+=("expected 4 anonymous rating rows")
for want in 'data-testid="anon-aggregates"' 'one of <!-- -->3' 'anchored 4.66' 'anchored 4.00' 'which receipt holder gave each rating'; do
  grep -qF -- "$want" <<<"$PAGE" || problems+=("missing: $want")
done
grep -qF '(client)' <<<"$PAGE" && problems+=("a rating is shown as sent from a client's address")
for p in auction audit; do curl -sf -o /dev/null "http://127.0.0.1:$WEB_PORT/$p" || problems+=("/$p no longer renders"); done
if ((${#problems[@]})); then printf 'PAGE CHECK FAILED: %s\n' "${problems[*]}" >&2; exit 1; fi
echo "PAGE CHECK PASSED: each rating shown as one of 3 receipt holders, averages anchored, no rater named"

printf '\nPhase 5 exit criterion met.\n'
if [[ "${KEEP:-0}" == 1 ]]; then echo "Everything is still running (pids ${PIDS[*]}). Open http://127.0.0.1:$WEB_PORT/indexer"; fi
