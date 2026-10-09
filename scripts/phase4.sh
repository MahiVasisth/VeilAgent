#!/usr/bin/env bash
# Phase 4 exit criterion, end to end from a clean Anvil:
#   deploy (ERC-8004 + Veil8004 core + consumers + MockForwarder) -> register agents
#   -> start the sealed store, the mock screening API and the local runner (SIMULATED DON)
#   -> scripts/src/phase4.ts: an auditor verifies one validation from a disclosure bundle and learns nothing about any
#      other; tampered bundles fail; the audit sends no transaction
#   -> no input in any service log; the audit page verifies the bundle, rejects the tampered one, and keeps every other
#      request sealed.
# Usage: make phase4        (KEEP=1 make phase4 leaves everything running at http://127.0.0.1:3000/audit)
set -euo pipefail
cd "$(dirname "$0")/.."
export ANVIL_RPC_URL=${ANVIL_RPC_URL:-http://127.0.0.1:8545}
export SEALED_STORE_URL=${SEALED_STORE_URL:-http://127.0.0.1:8787}
export MOCK_SCREENING_URL=${MOCK_SCREENING_URL:-http://127.0.0.1:8788}
ANVIL_PORT=${ANVIL_RPC_URL##*:}
WEB_PORT=${WEB_PORT:-3000}
LOGS=$(mktemp -d)
PIDS=()
# The demo's inputs (scripts/src/phase4.ts). Only the disclosed one may surface, and only in the auditor's report.
DISCLOSED='Northwind Trading LLC'
SEALED=('Kestrel Shipping Co' 'Harbor Light Ventures' 'Orrin Maritime SA')

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

step "Phase 4 flow: selective disclosure to an auditor"
DISCLOSURE_DIR="$LOGS" bun scripts/src/phase4.ts

step "service logs"
for f in runner sealed-store mock-screening; do
  for s in "$DISCLOSED" "${SEALED[@]}"; do
    if grep -qF -- "$s" "$LOGS/$f.log"; then echo "plaintext input '$s' found in $f log" >&2; exit 1; fi
  done
done
echo "service logs checked: no plaintext input in the runner, sealed-store or screening logs"

step "audit view (page): build and serve the frontend, then GET /audit and POST bundles to /audit/verify"
(cd frontend && bun run build >"$LOGS/next-build.log" 2>&1) || { cat "$LOGS/next-build.log"; exit 1; }
(cd frontend && exec bunx next start --port "$WEB_PORT" >"$LOGS/next.log" 2>&1) & PIDS+=($!)
wait_for "curl -sf -o /dev/null http://127.0.0.1:$WEB_PORT/audit"
PAGE=$(curl -s "http://127.0.0.1:$WEB_PORT/audit")
verify() { curl -s -o "$LOGS/verify.out" -w '%{http_code}' -X POST --data-binary "@$1" "http://127.0.0.1:$WEB_PORT/audit/verify"; }
GOOD_CODE=$(verify "$LOGS/bundle.json"); GOOD=$(cat "$LOGS/verify.out")
BAD_CODE=$(verify "$LOGS/bundle-tampered.json"); BAD=$(cat "$LOGS/verify.out")
printf 'not json' >"$LOGS/garbage.txt"; JUNK_CODE=$(verify "$LOGS/garbage.txt")

problems=()
[[ $(grep -o 'data-testid="audit-row"' <<<"$PAGE" | wc -l) -eq 4 ]] || problems+=("expected 4 request rows")
for want in 'data-testid="sim-banner"' 'SANCTIONS_SCREEN_V1' 'Disclosure bundle'; do
  grep -qF -- "$want" <<<"$PAGE" || problems+=("missing on page: $want")
done
for s in "$DISCLOSED" "${SEALED[@]}"; do
  if grep -qF -- "$s" <<<"$PAGE"; then problems+=("input '$s' on the page before any disclosure"); fi
done
[[ "$GOOD_CODE" == 200 ]] && grep -qF '"valid":true' <<<"$GOOD" && grep -qF "\"input\":\"$DISCLOSED\"" <<<"$GOOD" \
  || problems+=("the bundle did not verify through /audit/verify ($GOOD_CODE)")
[[ "$BAD_CODE" == 200 ]] && grep -qF '"valid":false' <<<"$BAD" && grep -qF '"request":null' <<<"$BAD" \
  || problems+=("the tampered bundle was not rejected ($BAD_CODE)")
[[ "$JUNK_CODE" == 400 ]] || problems+=("a malformed bundle should get 400, got $JUNK_CODE")
for s in "${SEALED[@]}"; do
  if grep -qF -- "$s" <<<"$GOOD$BAD"; then problems+=("sealed input '$s' in a verify response"); fi
done
for s in "$DISCLOSED" "${SEALED[@]}"; do
  if grep -qF -- "$s" "$LOGS/next.log"; then problems+=("input '$s' in the frontend server log"); fi
done
for p in indexer auction; do curl -sf -o /dev/null "http://127.0.0.1:$WEB_PORT/$p" || problems+=("/$p no longer renders"); done
if ((${#problems[@]})); then printf 'PAGE CHECK FAILED: %s\n' "${problems[*]}" >&2; exit 1; fi
echo "PAGE CHECK PASSED: all requests sealed on the page; the bundle verifies, the tampered one does not, nothing logged"

printf '\nPhase 4 exit criterion met.\n'
if [[ "${KEEP:-0}" == 1 ]]; then
  echo "Everything is still running (pids ${PIDS[*]}). Open http://127.0.0.1:$WEB_PORT/audit and paste $LOGS/bundle.json"
fi
