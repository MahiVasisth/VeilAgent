#!/usr/bin/env bash
# Phase 3 exit criterion, end to end from a clean Anvil:
#   deploy (ERC-8004 + Veil8004 core + TreasuryAction + SealedBidHiring + MockForwarder) -> register agents
#   -> start the sealed store, the mock screening API and the local runner (SIMULATED DON: W1 and W3)
#   -> scripts/src/phase3.ts: three attested agents bid, W3 awards the lowest, a loser verifies Merkle inclusion,
#      and no losing price appears on-chain
#   -> no losing price or credential in any service log; the auction page shows commitments, award and inclusion only.
# Usage: make phase3        (KEEP=1 make phase3 leaves everything running at http://127.0.0.1:3000/auction)
set -euo pipefail
cd "$(dirname "$0")/.."
export ANVIL_RPC_URL=${ANVIL_RPC_URL:-http://127.0.0.1:8545}
export SEALED_STORE_URL=${SEALED_STORE_URL:-http://127.0.0.1:8787}
export MOCK_SCREENING_URL=${MOCK_SCREENING_URL:-http://127.0.0.1:8788}
ANVIL_PORT=${ANVIL_RPC_URL##*:}
WEB_PORT=${WEB_PORT:-3000}
LOGS=$(mktemp -d)
PIDS=()
# The demo's losing prices (scripts/src/phase3.ts PRICES), raw and as the page would format them. Must never surface.
LOSING=('4217350000000000000000' '3904120000000000000000' '4217.35' '3904.12')
# The demo's credentials (scripts/src/phase3.ts CREDENTIALS). Must never surface outside the sealed payloads.
CREDS=('QS-2026-0417' 'QS-2026-0582' 'QS-2026-0733' 'QS-2025-0099')

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

step "deploy ERC-8004 registries, Veil8004 core, consumers and the MockForwarder (SIMULATION)"
DEPLOYER_KEY=$(cast wallet private-key "test test test test test test test test test test test junk" 0)
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast --private-key "$DEPLOYER_KEY" 2>&1 \
  | grep -E 'Registry|Forwarder|Treasury|Hiring|written')

step "register 3 agents"
(cd contracts && forge script script/RegisterAgents.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast 2>&1 | grep -E '^\s+agent ')

step "generate throwaway secrets for this run (never written to the repo)"
eval "$(bun -e 'import { generateKeyPair } from "./sdk/src/seal.ts"; const a = generateKeyPair(), b = generateKeyPair(); console.log(`export W1_PUBLIC_KEY=${a.publicKey} W1_DECRYPT_KEY=${a.secretKey} W3_PUBLIC_KEY=${b.publicKey} W3_DECRYPT_KEY=${b.secretKey}`)')"
export SEALED_STORE_W1_TOKEN=$(openssl rand -hex 32)
export SEALED_STORE_W3_TOKEN=$(openssl rand -hex 32)
export SCREENING_API_KEY=$(openssl rand -hex 32)
echo "W1 public key $W1_PUBLIC_KEY, W3 public key $W3_PUBLIC_KEY (secret keys, store tokens and API key kept in this shell only)"

step "start the sealed store, the mock screening API (MOCK) and the local runner (SIMULATED DON, W1 + W3)"
bun services/sealed-store/src/main.ts >"$LOGS/sealed-store.log" 2>&1 & PIDS+=($!)
bun services/mock-screening/src/main.ts >"$LOGS/mock-screening.log" 2>&1 & PIDS+=($!)
wait_for "curl -sf $SEALED_STORE_URL/health"
wait_for "curl -sf $MOCK_SCREENING_URL/health"
RUNNER_FROM_BLOCK=$(cast block-number --rpc-url "$ANVIL_RPC_URL") bun cre/local-runner/src/main.ts >"$LOGS/runner.log" 2>&1 & PIDS+=($!)
wait_for "grep -q BiddingClosed $LOGS/runner.log"

step "Phase 3 flow: sealed-bid hiring"
bun scripts/src/phase3.ts

step "local runner log (SIMULATED DON)"
sed 's/^/  /' "$LOGS/runner.log"
grep -q "award delivered" "$LOGS/runner.log" || { echo "expected the runner to deliver an award" >&2; exit 1; }
for f in runner sealed-store mock-screening; do
  for s in "${LOSING[@]}" "${CREDS[@]}"; do
    if grep -qF -- "$s" "$LOGS/$f.log"; then echo "secret '$s' found in $f log" >&2; exit 1; fi
  done
done
echo "service logs checked: no losing price and no credential in the runner, sealed-store or screening logs"

step "auction view (page): build and serve the frontend, then fetch /auction"
(cd frontend && bun run build >"$LOGS/next-build.log" 2>&1) || { cat "$LOGS/next-build.log"; exit 1; }
(cd frontend && exec bunx next start --port "$WEB_PORT" >"$LOGS/next.log" 2>&1) & PIDS+=($!)
wait_for "curl -sf -o /dev/null http://127.0.0.1:$WEB_PORT/auction"
PAGE=$(curl -s "http://127.0.0.1:$WEB_PORT/auction")

problems=()
[[ $(grep -o 'data-testid="bid-row"' <<<"$PAGE" | wc -l) -eq 3 ]] || problems+=("expected 3 bid rows")
[[ $(grep -oE 'data-testid="inclusion">counted<' <<<"$PAGE" | wc -l) -eq 3 ]] || problems+=("expected 3 counted inclusion checks")
for want in 'data-testid="sim-banner"' 'data-testid="award"' 'Borealis' '3100' 'QUALIFIED_SCREENER_V1' 'every losing bid price (never opened on-chain)'; do
  grep -qF -- "$want" <<<"$PAGE" || problems+=("missing: $want")
done
for s in "${LOSING[@]}" "${CREDS[@]}"; do
  if grep -qF -- "$s" <<<"$PAGE"; then problems+=("secret '$s' on the page"); fi
done
curl -sf -o /dev/null "http://127.0.0.1:$WEB_PORT/indexer" || problems+=("/indexer no longer renders")
if ((${#problems[@]})); then printf 'PAGE CHECK FAILED: %s\n' "${problems[*]}" >&2; exit 1; fi
echo "PAGE CHECK PASSED: bids shown as commitments, the award and the winning price, inclusion checks; no losing price"

printf '\nPhase 3 exit criterion met.\n'
if [[ "${KEEP:-0}" == 1 ]]; then
  echo "Everything is still running (pids ${PIDS[*]}). Open http://127.0.0.1:$WEB_PORT/auction"
fi
