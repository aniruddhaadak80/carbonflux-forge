---
name: ingest-evidence
description: Use when new or corrected source documents must be added to the evidence store, because content addressing decides whether a claim's support silently becomes invalid.
metadata:
  version: 1.0.0
---

# Ingest evidence into the store

## When to use this

A meter reading, an invoice, a published emission factor or a method statement has arrived, or a
document has been corrected and the old version needs to stay on the record.

## Steps

1. Decide the kind before storing it. It is part of the address's meaning, not a label:
   `activity-data`, `emission-factor`, `calibration`, `method`, `invoice`, `report`.
2. Store it with the tool that computes the address from the bytes:

   ```bash
   carbonflux-forge mcp call ingest_evidence '{"content":"source,year,unit,factor,uncertainty_pct\nDESNZ,2027,kgCO2e/kWh,0.16800,4.5\n","kind":"emission-factor","label":"UK non-domestic grid factor 2027"}'
   ```

3. Read the returned `address` and `stored`.
   - `stored: true` — the evidence is new.
   - `stored: false` — byte-identical evidence was already present. Nothing changed; that is the
     deduplication working, not a failure.
4. When a document **replaces** an earlier one, pass its address as `supersedes`. The old document
   stays in the store and stays addressable; it is the claims still citing it that become the
   finding. Never delete a superseded document — an auditor needs to see what was relied on at the
   time.
5. `carbonflux-forge evidence` — confirm the new document is marked current and the old one
   superseded.
6. `carbonflux-forge forge-all` — re-forge, because any claim citing the replaced document will
   now fail.

## Rules

- The address is the SHA-256 of the content. Editing a file in place changes its address, which is
  the intended behaviour: a corrected document is a new document, not an update.
- Never invent an address. If you do not have one, store the document and use the returned value.
- Never mark a source `trusted` to make a verdict pass. Untrusted evidence failing is the product
  working correctly.

## Verify

`carbonflux-forge evidence` lists the new address as current, and
`carbonflux-forge forge-all` reports the affected claim as unsupported with
`FACTOR_DOC_SUPERSEDED` until it is re-based.
