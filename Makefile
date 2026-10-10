# Veil8004 build entry points. See docs/SPEC.md.
SHELL := /bin/bash
CONTRACTS := contracts

.PHONY: help install artifacts build abis test phase1 phase2 phase3 phase4 phase5 frontend app demo simulate deploy-testnet clean

help:
	@echo "make install         install submodules and JS workspaces"
	@echo "make artifacts       fetch the Semaphore proving artifacts once (pinned hashes; proving is offline after)"
	@echo "make build           compile contracts (and TypeScript once it exists)"
	@echo "make test            forge tests + bun tests"
	@echo "make phase1          Phase 1 exit check: clean Anvil, public ERC-8004 flow, indexer view (KEEP=1 to leave it running)"
	@echo "make phase2          Phase 2 exit check: private validation, gate, local runner (SIMULATED DON), split view (KEEP=1 to leave it running)"
	@echo "make phase3          Phase 3 exit check: sealed-bid hiring, W3 award via local runner (SIMULATED DON), auction view (KEEP=1 to leave it running)"
	@echo "make phase4          Phase 4 exit check: selective disclosure, auditor CLI, audit view (KEEP=1 to leave it running)"
	@echo "make phase5          Phase 5 exit check: receipts via W2, anonymous ratings, nullifiers, anchored aggregate (KEEP=1 to leave it running)"
	@echo "make frontend        serve the frontend at http://127.0.0.1:3000 (needs a running, deployed Anvil)"
	@echo "make app             run everything locally and use the app at http://127.0.0.1:3000/app (Ctrl-C stops)"
	@echo "make demo            the whole demo on a clean Anvil, every step checked (KEEP=1 to present, PAUSE=1 to step; docs/demo.md)"
	@echo "make simulate        add N SIMULATED clients to a running demo chain (CLIENTS=6, RATE=1 to also rate)"
	@echo "make deploy-testnet  deploy to Monad testnet (needs .env; DRY_RUN=1 rehearses on a local fork, spends nothing)"

install:
	git submodule update --init --recursive
	bun install

artifacts:
	bun scripts/src/fetch-artifacts.ts

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

phase4:
	./scripts/phase4.sh

phase5:
	./scripts/phase5.sh

frontend:
	cd frontend && bun run dev

app:
	./scripts/app.sh

demo:
	./scripts/demo.sh

simulate:
	bun scripts/src/simulator.ts --clients $(or $(CLIENTS),6) $(if $(RATE),--rate,)

deploy-testnet:
	./scripts/deploy-testnet.sh

clean:
	cd $(CONTRACTS) && forge clean
	rm -rf frontend/.next
