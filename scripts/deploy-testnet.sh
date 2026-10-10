#!/usr/bin/env bash
# make deploy-testnet: deploy Veil8004 to Monad testnet (chain 10143) against the live ERC-8004 Identity and Reputation
# registries and the CRE forwarder, then check every address has code and is wired (scripts/src/check-deployment.ts).
#   DRY_RUN=1 make deploy-testnet   rehearse on a local Anvil fork of Monad testnet: the real registries, the real
#                                   forwarder, a funded throwaway key. Spends nothing and leaves deployments/ untouched.
# Needs .env: DEPLOYER_PRIVATE_KEY (funded, real run only), TREASURY_OPERATOR, CRE_FORWARDER_ADDRESS,
#             IDENTITY_REGISTRY, REPUTATION_REGISTRY, MONAD_TESTNET_RPC_URL. Optional: VALIDATION_REGISTRY (empty = deploy
#             our own, docs/phase0.md Q5), W1/W2/W3_WORKFLOW_ID (pin now, or later with setExpectedWorkflowId).
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=${ENV_FILE:-.env}
[[ -f "$ENV_FILE" ]] || { echo "missing $ENV_FILE (cp .env.example .env and fill it in)" >&2; exit 1; }
set -a; source "$ENV_FILE"; set +a
RPC=${MONAD_TESTNET_RPC_URL:-https://testnet-rpc.monad.xyz}
CHAIN=10143
FORK_PORT=${FORK_PORT:-8555}
step() { printf '\n==> %s\n' "$*"; }
need() { [[ -n "${!1:-}" ]] || { echo "$1 is required in $ENV_FILE" >&2; exit 1; }; }
for v in TREASURY_OPERATOR CRE_FORWARDER_ADDRESS IDENTITY_REGISTRY REPUTATION_REGISTRY; do need "$v"; done

step "preflight against $RPC"
[[ "$(cast chain-id --rpc-url "$RPC")" == "$CHAIN" ]] || { echo "$RPC is not chain $CHAIN" >&2; exit 1; }
for name in IDENTITY_REGISTRY REPUTATION_REGISTRY CRE_FORWARDER_ADDRESS; do
  [[ "$(cast code "${!name}" --rpc-url "$RPC")" != "0x" ]] || { echo "$name ${!name} has no code on chain $CHAIN" >&2; exit 1; }
  echo "  $name ${!name} has code"
done

(cd contracts && forge build --quiet)
DEPLOYMENT=contracts/deployments/$CHAIN.json

if [[ "${DRY_RUN:-0}" == 1 ]]; then
  step "DRY RUN: fork chain $CHAIN into a local Anvil on port $FORK_PORT"
  anvil --fork-url "$RPC" --port "$FORK_PORT" --silent & FORK_PID=$!
  # forge records the run in deployments/ and broadcast/; put both back as they were afterwards.
  BROADCAST=contracts/broadcast/Deploy.s.sol/$CHAIN
  BACKUP=$(mktemp -d)
  [[ -f "$DEPLOYMENT" ]] && cp "$DEPLOYMENT" "$BACKUP/"
  [[ -d "$BROADCAST" ]] && cp -R "$BROADCAST" "$BACKUP/broadcast"
  restore() {
    kill "$FORK_PID" 2>/dev/null || true
    rm -rf "$DEPLOYMENT" "$BROADCAST"
    [[ -f "$BACKUP/$CHAIN.json" ]] && cp "$BACKUP/$CHAIN.json" "$DEPLOYMENT"
    [[ -d "$BACKUP/broadcast" ]] && cp -R "$BACKUP/broadcast" "$BROADCAST"
    return 0
  }
  trap restore EXIT
  for _ in $(seq 1 150); do cast chain-id --rpc-url "http://127.0.0.1:$FORK_PORT" >/dev/null 2>&1 && break; sleep 0.2; done
  KEY=$(cast wallet new --json | bun -e 'console.log(JSON.parse(await Bun.stdin.text())[0].private_key)')
  cast rpc anvil_setBalance "$(cast wallet address "$KEY")" 0x56BC75E2D63100000 --rpc-url "http://127.0.0.1:$FORK_PORT" >/dev/null
  TARGET=http://127.0.0.1:$FORK_PORT
else
  need DEPLOYER_PRIVATE_KEY
  KEY=$DEPLOYER_PRIVATE_KEY
  TARGET=$RPC
  BAL=$(cast balance "$(cast wallet address "$KEY")" --rpc-url "$RPC")
  echo "  deployer $(cast wallet address "$KEY") balance $(cast from-wei "$BAL") MON"
  [[ "$BAL" != 0 ]] || { echo "the deployer has no MON; fund it from the Monad testnet faucet" >&2; exit 1; }
  if [[ -f "$DEPLOYMENT" ]]; then
    echo "$DEPLOYMENT exists: a deployment is already recorded. Move it aside to deploy again." >&2; exit 1
  fi
  read -r -p "Deploy Veil8004 to Monad testnet from $(cast wallet address "$KEY")? [y/N] " ok
  [[ "$ok" == y || "$ok" == Y ]] || exit 1
fi

step "deploy (contracts/script/Deploy.s.sol)"
LOG=$(mktemp)
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$TARGET" --broadcast --slow --private-key "$KEY" 2>&1) | tee "$LOG" \
  | grep -E 'Registry|Forwarder|Hiring|Semaphore|Receipt|Feedback|Treasury|ONCHAIN|Error|error' || true
grep -q "ONCHAIN EXECUTION COMPLETE & SUCCESSFUL" "$LOG" || { echo "broadcast did not complete; see $LOG (docs/phase0.md T-4)" >&2; exit 1; }

step "check the recorded addresses on chain"
RPC_URL=$TARGET bun scripts/src/check-deployment.ts "$CHAIN"

if [[ "${DRY_RUN:-0}" == 1 ]]; then
  printf '\nDRY RUN passed on a fork of chain %s. Nothing was sent to Monad testnet; %s is unchanged.\n' "$CHAIN" "$DEPLOYMENT"
else
  cat <<NEXT

Deployed to Monad testnet; addresses in $DEPLOYMENT (commit it).
Next (docs/phase0.md C-2):
  1. cre workflow deploy for cre/workflows/w1-validator, w3-bid-opener, w2-receipt-issuer (configs point at these addresses)
  2. pin each workflow id on its consumer:  cast send <consumer> "setExpectedWorkflowId(bytes32)" <id> --private-key \$DEPLOYER_PRIVATE_KEY --rpc-url $RPC
  3. register the agents with their own keys:  AGENT_PRIVATE_KEYS=k1,k2,k3 forge script script/RegisterAgents.s.sol --rpc-url $RPC --broadcast
NEXT
fi
