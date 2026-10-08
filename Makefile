# Veil8004 build entry points. See docs/SPEC.md.
SHELL := /bin/bash
CONTRACTS := contracts

.PHONY: help install build test demo deploy-testnet clean

help:
	@echo "make install         install submodules and JS workspaces"
	@echo "make build           compile contracts (and TypeScript once it exists)"
	@echo "make test            forge tests + bun tests"
	@echo "make demo            run the demo script on a clean Anvil (Phase 6)"
	@echo "make deploy-testnet  deploy to Monad testnet (needs .env)"

install:
	git submodule update --init --recursive
	bun install

build:
	cd $(CONTRACTS) && forge build

test:
	cd $(CONTRACTS) && forge test -vv
	@if find sdk cre services scripts -name '*.test.ts' -not -path '*/node_modules/*' | grep -q .; then \
	  bun test sdk cre services scripts; \
	else echo "no TypeScript tests yet"; fi

demo:
	@echo "make demo: not implemented yet. It lands with scripts/demo.ts (Phases 1-6)." >&2; exit 1

deploy-testnet:
	@test -f .env || { echo "missing .env (copy .env.example)" >&2; exit 1; }
	@echo "make deploy-testnet: not implemented yet. It lands with script/Deploy.s.sol (Phase 1+)." >&2; exit 1

clean:
	cd $(CONTRACTS) && forge clean
	rm -rf frontend/.next
