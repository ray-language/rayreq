# RayReq — common tasks. `make` (or `make help`) lists them.

.DEFAULT_GOAL := help
.PHONY: help run dev test test-native check check-markup fmt build bundle-macos icon

help: ## List the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "} {printf "  %-14s %s\n", $$1, $$2}'

run: ## Open the app (data in the OS data dir; RAYREQ_DATA=<dir> overrides it)
	ray run

dev: ## Same, restarting on changes
	ray dev

test: ## Unit and protocol tests (URLs, sending, store, views, page protocol)
	ray test

test-native: ## The same tests as native binaries
	ray test --native

check: ## The real page driven through a send against a local server (scratch database)
	ray run src/main.ray --check

check-markup: ## ray-elements' markup checker over www/
	node .ray-deps/elements/web/check/cli.js check www/

fmt: ## Format the raylang sources
	ray fmt --write src/*.ray tests/*.ray

build: ## Native binary, refusing anything outside the native subset
	ray build --native --no-stubs

bundle-macos: ## RayReq.app
	ray bundle

icon: ## Render brand/icon.png (the bundle icon) from brand/icon.svg (needs rsvg-convert); copy it for the page's About
	rsvg-convert -w 1024 -h 1024 brand/icon.svg -o brand/icon.png
	cp brand/icon.svg www/icon.svg
