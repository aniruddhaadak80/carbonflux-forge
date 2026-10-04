---
name: product-overview
description: Use when someone new to CarbonFlux Forge needs to understand what it does and where its capabilities live, because the surface area is wider than one README can convey.
metadata:
  version: 1.0.0
---

# CarbonFlux Forge overview

## When to use this

You are orienting yourself in CarbonFlux Forge and need the map, not the detail.

## The one idea

Every capability in CarbonFlux Forge is a **Tool** registered in exactly one registry. The CLI,
the web app, the MCP server, and every channel adapter are thin transports over that one
registry. There is no second code path.

## Steps

1. Run `carbonflux-forge doctor` — it probes every subsystem and prints a fix hint per failing row.
2. Run `carbonflux-forge tools --json` — the authoritative list of capabilities.
3. Read `docs/architecture.md` for the narrow waist and the footprint ladder.

## Where capability belongs

In order of preference. Adding to the core registry is the _last_ option, not the first:

1. Extend an existing tool
2. Add a CLI command plus a skill
3. Add a service-gated tool with a `check_fn`
4. Add a plugin
5. Add an MCP server tool to the catalog
6. Add a new core tool

## Verify

`carbonflux-forge doctor` exits 0 and `carbonflux-forge tools --json` lists at least one tool.
