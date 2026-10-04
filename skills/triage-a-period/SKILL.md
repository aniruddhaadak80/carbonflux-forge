---
name: triage-a-period
description: Use when asked which numbers in a reporting period are still trustworthy, because forge-all returns the census and a per-claim reason for everything that is not.
metadata:
  version: 1.0.0
---

# Triage a reporting period

## When to use this

A user asks "is our inventory ready to report", "what do we need to fix", or wants the state of a
whole period rather than one line.

## Steps

1. `carbonflux-forge forge-all` — forge every claim and get the census by status. Each verdict is
   recorded, so later single-claim questions are already answered.
2. `carbonflux-forge claims` — read the whole list with each recorded status. Work the non-supported
   rows first; that is where the reporting risk is.
3. Group the failures by cause, not by claim. The causes are separable and each has a different
   owner:
   - arithmetic that does not reproduce → whoever maintains the activity data
   - superseded or untrusted evidence → whoever publishes the emission factors
   - unit mismatch → whoever maintains the inventory spreadsheet
   - circular provenance → whoever set the allocation method
4. `carbonflux-forge recompute <claimId>` for any arithmetic case, to show the numbers side by side
   rather than only the verdict.
5. `carbonflux-forge lineage <claimId>` for any provenance case, to name the specific document that
   has to change.

## What not to do

- Do not fix a claim by editing its reported tonnage to match the recomputation. That makes the
  number agree with the evidence while destroying the record that it once disagreed. Change the
  evidence or the method, then re-forge.
- Do not re-point a claim at a newer factor revision silently. The superseded evidence is the
  finding; record that it was re-based and why.

## Verify

`carbonflux-forge forge-all` reports `count` equal to the number of rows in `carbonflux-forge claims`,
and a second run produces identical seals.
