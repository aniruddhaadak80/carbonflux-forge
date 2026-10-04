"""The inventory vintage layer.

A GHG inventory is reissued every quarter, so the product needs to answer "what changed since
last time?" before it can answer "does this hold?". These three operations are that layer:
`normalize` canonicalises a vintage, `diff` compares two, `summarize` takes the census.

Each function is pure: it reads its arguments, it returns a value, it touches nothing else.

The verdict engine — recompute, walk, forge — lives in `forge.py`, and both sets of operations
are merged into `OPERATIONS` below so there is exactly one dispatch table.

  - pure functions only
  - typed input via TypedDict / dataclass
  - no clock, no network, no randomness
  - a named operation per entry point, registered in OPERATIONS
"""

from __future__ import annotations

from typing import Any, Final, TypedDict

from .forge import FORGE_OPERATIONS
from .protocol import EngineError


class Record(TypedDict):
    id: str
    kind: str
    payload: dict[str, Any]
    createdAt: int
    updatedAt: int


class NormalizeInput(TypedDict):
    records: list[Record]


class NormalizedRecord(TypedDict):
    id: str
    kind: str
    fields: dict[str, Any]
    updatedAt: int


class NormalizeOutput(TypedDict):
    records: list[NormalizedRecord]
    kinds: list[str]
    count: int


class DiffInput(TypedDict):
    before: list[Record]
    after: list[Record]


class Change(TypedDict):
    id: str
    kind: str
    change: str
    fields: list[str]


class DiffOutput(TypedDict):
    added: list[str]
    removed: list[str]
    changed: list[Change]
    unchanged: int


class SummaryInput(TypedDict):
    records: list[Record]


class SummaryOutput(TypedDict):
    total: int
    byKind: dict[str, int]
    oldest: int
    newest: int


def _require_records(payload: Any, field: str) -> list[Record]:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", f"expected an object with {field!r}")
    records = payload.get(field)
    if not isinstance(records, list):
        raise EngineError("BAD_SHAPE", f"{field!r} must be a list")
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            raise EngineError("BAD_SHAPE", f"{field}[{index}] must be an object")
        for key in ("id", "kind", "payload", "createdAt", "updatedAt"):
            if key not in record:
                raise EngineError("MISSING_FIELD", f"{field}[{index}] is missing {key!r}")
        if not isinstance(record["payload"], dict):
            raise EngineError("BAD_SHAPE", f"{field}[{index}].payload must be an object")
    return records


def normalize(payload: NormalizeInput) -> NormalizeOutput:
    """Flatten records into a stable, sorted, comparable shape.

    Deterministic by construction: output order depends only on the input, never on dict
    iteration order, the clock, or the filesystem.
    """
    records = _require_records(payload, "records")
    normalized: list[NormalizedRecord] = []
    for record in records:
        payload_obj = record["payload"]
        normalized.append(
            {
                "id": record["id"],
                "kind": record["kind"],
                "fields": {key: payload_obj[key] for key in sorted(payload_obj)},
                "updatedAt": record["updatedAt"],
            }
        )
    normalized.sort(key=lambda item: (item["kind"], item["id"]))
    return {
        "records": normalized,
        "kinds": sorted({item["kind"] for item in normalized}),
        "count": len(normalized),
    }


def diff(payload: DiffInput) -> DiffOutput:
    """Compute a minimal structural diff between two record sets."""
    before = {record["id"]: record for record in _require_records(payload, "before")}
    after = {record["id"]: record for record in _require_records(payload, "after")}

    added = sorted(set(after) - set(before))
    removed = sorted(set(before) - set(after))
    changed: list[Change] = []
    unchanged = 0

    for identifier in sorted(set(before) & set(after)):
        left = before[identifier]
        right = after[identifier]
        if left == right:
            unchanged += 1
            continue
        touched = sorted(
            set(left["payload"]) ^ set(right["payload"])
            | {key for key in set(left["payload"]) & set(right["payload"])
               if left["payload"][key] != right["payload"][key]}
        )
        changed.append(
            {"id": identifier, "kind": right["kind"], "change": "modified", "fields": touched}
        )

    return {"added": added, "removed": removed, "changed": changed, "unchanged": unchanged}


def summarize(payload: SummaryInput) -> SummaryOutput:
    """Aggregate counts without mutating or discarding anything."""
    records = _require_records(payload, "records")
    by_kind: dict[str, int] = {}
    for record in records:
        by_kind[record["kind"]] = by_kind.get(record["kind"], 0) + 1
    stamps = [record["updatedAt"] for record in records] or [0]
    return {
        "total": len(records),
        "byKind": dict(sorted(by_kind.items())),
        "oldest": min(stamps),
        "newest": max(stamps),
    }


OPERATIONS: Final[dict[str, Any]] = {
    "normalize": normalize,
    "diff": diff,
    "summarize": summarize,
    **FORGE_OPERATIONS,
}


def analyse(op: str, payload: Any) -> Any:
    handler = OPERATIONS.get(op)
    if handler is None:
        known = ", ".join(sorted(OPERATIONS))
        raise EngineError("UNKNOWN_OP", f"unknown op {op!r}; available: {known}")
    return handler(payload)
