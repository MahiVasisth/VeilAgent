#!/usr/bin/env bash
# make app: a fresh local chain with everything deployed and running, for using the app at http://127.0.0.1:3000/app.
#   clean Anvil -> deploy -> register 3 demo agents (Atlas, Borealis, Cirrus) -> sealed store, mock screening (MOCK) and
#   the local runner (SIMULATED DON: W1, W3, W2) -> the frontend. Only a plain ERC-8004 baseline (two public hires, for
#   the indexer comparison) is put on-chain; everything Veil8004 you do in the app.
# Stays in the foreground; Ctrl-C stops everything. For the scripted walkthrough instead, use make demo.
set -euo pipefail
cd "$(dirname "$0")/.."
export ANVIL_RPC_URL=${ANVIL_RPC_URL:-http://127.0.0.1:8545}
export SEALED_STORE_URL=${SEALED_STORE_URL:-http://127.0.0.1:8787}
export MOCK_SCREENING_URL=${MOCK_SCREENING_URL:-http://127.0.0.1:8788}
ANVIL_PORT=${ANVIL_RPC_URL##*:}
WEB_PORT=${WEB_PORT:-3000}
LOGS=$(mktemp -d)
PIDS=()

cleanup() { for p in "${PIDS[@]:-}"; do [[ -n "$p" ]] && kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM
wait_for() { for _ in $(seq 1 150); do eval "$1" >/dev/null 2>&1 && return 0; sleep 0.2; done; echo "timed out: $1" >&2; return 1; }
step() { printf '\n==> %s\n' "$*"; }

for tool in anvil forge cast bun curl openssl; do
  command -v "$tool" >/dev/null || { echo "missing $tool; see README.md Setup" >&2; exit 1; }
done
if cast chain-id --rpc-url "$ANVIL_RPC_URL" >/dev/null 2>&1; then
  echo "something is already listening on $ANVIL_RPC_URL; stop it first (an earlier make app or KEEP=1 run?)" >&2; exit 1
fi
for url in "$SEALED_STORE_URL" "$MOCK_SCREENING_URL" "http://127.0.0.1:$WEB_PORT"; do
  if curl -s -o /dev/null "$url"; then echo "$url is in use; stop it first" >&2; exit 1; fi
done

step "proving artifacts (rating proofs run in your browser, on these pinned files)"
if ! bun -e 'import { snarkArtifacts, DEFAULT_DEPTHS } from "./sdk/src/snarkArtifacts.ts"; for (const d of DEFAULT_DEPTHS) snarkArtifacts(d)' 2>/dev/null; then
  bun scripts/src/fetch-artifacts.ts
fi

step "build contracts, ABIs and the frontend (logs: $LOGS)"
(cd contracts && forge build --quiet)
bun scripts/src/gen-abis.ts
(cd frontend && bun run build >"$LOGS/next-build.log" 2>&1) || { cat "$LOGS/next-build.log"; exit 1; }

step "start a clean Anvil, deploy, register Atlas, Borealis and Cirrus"
anvil --port "$ANVIL_PORT" --silent >"$LOGS/anvil.log" 2>&1 & PIDS+=($!)
wait_for "cast chain-id --rpc-url $ANVIL_RPC_URL"
DEPLOYER_KEY=$(cast wallet private-key "test test test test test test test test test test test junk" 0)
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast --private-key "$DEPLOYER_KEY" >"$LOGS/deploy.log" 2>&1) \
  || { cat "$LOGS/deploy.log"; exit 1; }
(cd contracts && forge script script/RegisterAgents.s.sol --rpc-url "$ANVIL_RPC_URL" --broadcast 2>&1 | grep -E '^\s+agent ')

step "a plain ERC-8004 baseline (two public hires), so /indexer has something to compare against"
bun scripts/src/baseline.ts >"$LOGS/baseline.log" 2>&1 || { cat "$LOGS/baseline.log"; exit 1; }

step "workflow keys for this run (decryption keys stay in the local runner's memory)"
eval "$(bun -e 'import { generateKeyPair } from "./sdk/src/seal.ts"; const a = generateKeyPair(), b = generateKeyPair(); console.log(`export W1_PUBLIC_KEY=${a.publicKey} W1_DECRYPT_KEY=${a.secretKey} W3_PUBLIC_KEY=${b.publicKey} W3_DECRYPT_KEY=${b.secretKey}`)')"
export SEALED_STORE_W1_TOKEN=$(openssl rand -hex 32)
export SEALED_STORE_W3_TOKEN=$(openssl rand -hex 32)
export SCREENING_API_KEY=$(openssl rand -hex 32)

step "sealed store, mock screening (MOCK) and the local runner (SIMULATED DON: W1, W3, W2)"
bun services/sealed-store/src/main.ts >"$LOGS/sealed-store.log" 2>&1 & PIDS+=($!)
bun services/mock-screening/src/main.ts >"$LOGS/mock-screening.log" 2>&1 & PIDS+=($!)
wait_for "curl -sf $SEALED_STORE_URL/health"
wait_for "curl -sf $MOCK_SCREENING_URL/health"
RUNNER_FROM_BLOCK=$(cast block-number --rpc-url "$ANVIL_RPC_URL") bun cre/local-runner/src/main.ts >"$LOGS/runner.log" 2>&1 & PIDS+=($!)
wait_for "grep -q JobCompleted $LOGS/runner.log"

step "frontend"
# The app server gets only the workflows' PUBLIC keys (plus the store URL); it never sees a decryption key.
(cd frontend && exec env -u W1_DECRYPT_KEY -u W3_DECRYPT_KEY -u SEALED_STORE_W1_TOKEN -u SEALED_STORE_W3_TOKEN -u SCREENING_API_KEY \
  bunx next start --port "$WEB_PORT" >"$LOGS/next.log" 2>&1) & PIDS+=($!)
wait_for "curl -sf -o /dev/null http://127.0.0.1:$WEB_PORT/api/config"

cat <<EOF2

Veil8004 is running:  http://127.0.0.1:$WEB_PORT/app

  Pick a demo account (or connect MetaMask to http://127.0.0.1:$ANVIL_PORT, chain 31337) and try:
    1. As Atlas's/Borealis's owner: "Bid on work" -> Get qualified with QS-2026-0417 / QS-2026-0582
    2. As Client A: "Hire an agent" -> Post task
    3. As the agent owners: place sealed bids
    4. "+10 min" to pass the deadline, Close bidding; W3 awards the lowest
    5. As Client A: Mark job completed, then Rate anonymously
  Logs: $LOGS (runner.log shows the SIMULATED DON at work). Ctrl-C stops everything.
EOF2
wait
