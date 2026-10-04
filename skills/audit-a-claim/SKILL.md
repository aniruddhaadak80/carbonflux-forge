---
name: audit-a-claim
description: Use when someone asks whether a specific greenhouse-gas number still holds, or what a claim rests on, because forge reports a verdict and a reason rather than a score.
metadata:
  version: 1.0.0
---

# Audit one inventory claim

## When to use this

A user points at a number in a GHG inventory and asks whether it is right, what it is based on,
or why it changed.

## Steps

1. `carbonflux-forge claims` — confirm the claim id exists and see whether it has been forged
   already. A `UNFORGED` status means no verdict is on record; do not quote one.
2. `carbonflux-forge forge <claimId>` — recompute it from its own evidence and read the verdict.
3. Read `status` first, then `reasons`. Never report a verdict without its reason.
4. If `status` is `unsupported`, read the arithmetic and separate the two possible causes:
   - `DELTA_OVER_TOLERANCE` — the reported figure does not reproduce from the activity data and
     the factor. The number is wrong.
   - `FACTOR_DOC_SUPERSEDED` / `FACTOR_DOC_UNTRUSTED` / `SUPERSEDED_NODE` — the arithmetic may be
     fine and the evidence no longer stands. The number is unproven, not necessarily wrong.
5. `carbonflux-forge lineage <claimId>` — show the chain of support. Depth and the terminal
   addresses are the answer to "what does this rest on".
6. `carbonflux-forge evidence` — if a factor is superseded, this names the revision that replaced
   it, so you can name what to re-base onto.

## Reporting rules

- Quote the **seal**. Two runs that produce the same seal are the reproducibility check an auditor
  can actually perform, and it is the strongest thing this tool hands you.
- `supported` means the figure reproduces within tolerance from evidence that is current and
  trusted. It is not a statement that the figure is small, fair or complete.
- `circular` means the claim ultimately rests on itself. There is no arithmetic answer to give;
  the allocation method has to be fixed by a person.
- `unverified` means the walk hit its budget or reached no terminal evidence. Report that the chain
  was not fully established — never round it up to `supported`.

## Verify

`carbonflux-forge forge <claimId>` run twice returns the same `seal`.
