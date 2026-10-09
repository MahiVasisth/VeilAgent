# Veil8004 build entry points. See docs/SPEC.md.
SHELL := /bin/bash
CONTRACTS := contracts

.PHONY: help install build abis test phase1 phase2 phase3 frontend demo deploy-testnet clean

help:
	@echo "make install         install submodules and JS workspaces"
	@echo "make build           compile contracts (and TypeScript once it exists)"
	@echo "make test            forge tests + bun tests"
	@echo "make phase1          Phase 1 exit check: clean Anvil, public ERC-8004 flow, indexer view (KEEP=1 to leave it running)"
	@echo "make phase2          Phase 2 exit check: private validation, gate, local runner (SIMULATED DON), split view (KEEP=1 to leave it running)"
	@echo "make phase3          Phase 3 exit check: sealed-bid hiring, W3 award via local runner (SIMULATED DON), auction view (KEEP=1 to leave it running)"
	@echo "make frontend        serve the frontend at http://127.0.0.1:3000 (needs a running, deployed Anvil)"
	@echo "make demo            run the demo script on a clean Anvil (Phase 6)"
	@echo "make deploy-testnet  deploy to Monad testnet (needs .env)"

install:
	git submodule update --init --recursive
	bun install

build:
	cd $(CONTRACTS) && forge build
	bun scripts/src/gen-abis.ts

abis:
	cd $(CONTRACTS) && forge build
	bun scripts/src/gen-abis.ts

test:
	cd $(CONTRACTS) && forge test -vv
	@if find sdk cre services scripts -name '*.test.ts' -not -path '*/node_modules/*' | grep -q .; then \
	  bun test sdk cre services scripts; \
	else echo "no TypeScript tests yet"; fi

phase1:
	./scripts/phase1.sh

phase2:
	./scripts/phase2.sh

phase3:
	./scripts/phase3.sh

frontend:
	cd frontend && bun run dev

demo:
	@echo "make demo: not implemented yet. It lands with scripts/demo.ts (Phases 1-6)." >&2; exit 1

deploy-testnet:
	@test -f .env || { echo "missing .env (copy .env.example)" >&2; exit 1; }
	@echo "make deploy-testnet: not implemented yet. It lands with script/Deploy.s.sol (Phase 1+)." >&2; exit 1

clean:
	cd $(CONTRACTS) && forge clean
	rm -rf frontend/.next
