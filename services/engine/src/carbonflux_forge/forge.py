"""The forge: arithmetic, provenance walking, and verdict sealing.

These three operations are why an auditor can trust the number. Each one is a pure function of
its arguments — no clock, no network, no randomness, no filesystem — so the same evidence always
produces the same verdict, forever, on any machine.

    recompute_claim   quantity x emission factor -> tCO2e, with propagated uncertainty
    walk_provenance   depth-first support walk with cycle detection and a hard visit budget
    forge_verdict     fold the two into supported | unsupported | circular | unverified

Money-like quantities are carried as ``Decimal`` end to end. A greenhouse-gas inventory is
audited to the decimal place, and IEEE-754 drift on a value that is summed across thousands of
rows is a real finding, not a theoretical one.
"""

from __future__ import annotations

import hashlib
import json
from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation, localcontext
from typing import Any, Final, TypedDict

from .protocol import EngineError

# 50 significant digits is far beyond any inventory, and fixing it here is what makes two runs
# on two machines agree bit for bit.
PRECISION: Final[int] = 50

DEFAULT_SIGFIGS: Final[int] = 6
DEFAULT_BUDGET: Final[int] = 10_000
DEFAULT_TOLERANCE_PCT: Final[str] = "2"

#: A graph can have exponentially many root-to-terminal paths. Returning the first few is enough
#: to show a reader why a claim is grounded; returning all of them would be a denial of service.
MAX_PATHS: Final[int] = 8

MIN_SIGFIGS: Final[int] = 1
MAX_SIGFIGS: Final[int] = 15

#: Relations that carry support from a claim down to the evidence it rests on.
SUPPORT_RELATIONS: Final[frozenset[str]] = frozenset(
    {"derived-from", "calibrated-by", "measured-by"}
)

#: Relations that mark one document as replacing another. The replaced document is no longer
#: usable support, even though it is still in the graph.
REPLACEMENT_RELATIONS: Final[frozenset[str]] = frozenset({"supersedes"})

#: Mass units an emission factor may be expressed in, with the kilograms of CO2e they denote.
MASS_UNITS: Final[dict[str, str]] = {
    "gCO2e": "0.001",
    "kgCO2e": "1",
    "tCO2e": "1000",
    "ktCO2e": "1000000",
}

TONNES_PER_KG: Final[str] = "0.001"

# Defect codes. `blocking` decides whether a defect alone makes a claim unsupported.
BLOCKING: Final[frozenset[str]] = frozenset(
    {
        "FACTOR_DOC_MISSING",
        "FACTOR_DOC_SUPERSEDED",
        "FACTOR_DOC_UNTRUSTED",
        "UNIT_MISMATCH",
        "UNKNOWN_MASS_UNIT",
        "NOT_A_DECIMAL",
        "DANGLING_EDGE",
        "UNTRUSTED_NODE",
        "SUPERSEDED_NODE",
    }
)

DOCUMENT_KINDS: Final[frozenset[str]] = frozenset(
    {"activity-data", "emission-factor", "calibration", "method", "invoice", "report"}
)


class Document(TypedDict):
    address: str
    kind: str
    label: str
    capturedAt: int
    supersedes: str | None
    trusted: bool


class Claim(TypedDict):
    id: str
    scope: int
    category: str
    activityQuantity: str
    activityUnit: str
    factorValue: str
    factorUnit: str
    factorAddress: str
    factorUncertaintyPct: str
    reportedTonnes: str
    period: str


class Node(TypedDict):
    id: str
    type: str
    address: str
    kind: str
    trusted: bool


# The functional form is required here: `from` is a Python keyword, so the class-body syntax
# cannot declare it, and the wire format keeps the familiar "from"/"to" edge keys.
Edge = TypedDict("Edge", {"from": str, "to": str, "relation": str})


class Graph(TypedDict):
    nodes: list[Node]
    edges: list[Edge]


class Defect(TypedDict):
    code: str
    message: str
    node: str


class FactorReport(TypedDict):
    address: str
    kind: str
    present: bool
    trusted: bool
    superseded: bool


class Computation(TypedDict):
    claimId: str
    recomputedKg: str
    recomputedTonnes: str
    exactTonnes: str
    reportedTonnes: str
    deltaTonnes: str
    deltaPct: str
    uncertaintyTonnes: str
    roundingResidual: str
    withinTolerance: bool
    tolerancePct: str
    sigFigs: int
    factors: list[FactorReport]
    defects: list[Defect]


class Terminal(TypedDict):
    id: str
    address: str
    kind: str


class Walk(TypedDict):
    root: str
    visited: int
    budget: int
    budgetExhausted: bool
    supportDepth: int
    terminals: list[Terminal]
    paths: list[list[str]]
    pathsTruncated: bool
    cycle: list[str] | None
    defects: list[Defect]


class Verdict(TypedDict):
    claimId: str
    status: str
    reasons: list[str]
    computation: Computation
    walk: Walk
    seal: str
    engine: str


ENGINE_NAME: Final[str] = "carbonflux_forge/1"


# --------------------------------------------------------------------------- shape guards


def _obj(payload: Any, field: str) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", f"expected an object with {field!r}")
    value = payload.get(field)
    if not isinstance(value, dict):
        raise EngineError("BAD_SHAPE", f"{field!r} must be an object")
    return value


def _obj_list(payload: Any, field: str) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", f"expected an object with {field!r}")
    value = payload.get(field)
    if not isinstance(value, list):
        raise EngineError("BAD_SHAPE", f"{field!r} must be a list")
    for index, entry in enumerate(value):
        if not isinstance(entry, dict):
            raise EngineError("BAD_SHAPE", f"{field}[{index}] must be an object")
    return value


def _decimal(raw: Any, field: str, defects: list[Defect]) -> Decimal:
    """Parse a decimal from a string. A bad value is a finding, not a crash: an inventory with
    one malformed cell must still produce a verdict about the other 4,999 claims."""
    if not isinstance(raw, str):
        defects.append({"code": "NOT_A_DECIMAL", "message": f"{field} must be a decimal string",
                        "node": field})
        return Decimal(0)
    try:
        parsed = Decimal(raw)
    except InvalidOperation:
        defects.append({"code": "NOT_A_DECIMAL", "message": f"{field} is not a decimal: {raw!r}",
                        "node": field})
        return Decimal(0)
    if not parsed.is_finite():
        defects.append({"code": "NOT_A_DECIMAL", "message": f"{field} is not finite", "node": field})
        return Decimal(0)
    return parsed


def _clamped_int(payload: Any, field: str, default: int, low: int, high: int) -> int:
    raw = payload.get(field, default) if isinstance(payload, dict) else default
    if isinstance(raw, bool) or not isinstance(raw, int):
        return default
    return max(low, min(high, raw))


# --------------------------------------------------------------------------- recompute


def round_significant(value: Decimal, sigfigs: int) -> Decimal:
    """Round to `sigfigs` significant figures, half-to-even.

    Half-to-even rather than half-up because it is the rounding a spreadsheet's ROUND() does and
    therefore the one a reader will reproduce by hand when they disagree with us.
    """
    if value == 0:
        return Decimal(0)
    quantum = Decimal(1).scaleb(value.adjusted() - (sigfigs - 1))
    try:
        return value.quantize(quantum, rounding=ROUND_HALF_EVEN)
    except InvalidOperation:
        return value


def recompute_claim(
    claim: Claim, documents: list[Document], sigfigs: int, tolerance_pct: Decimal
) -> Computation:
    """Rebuild one inventory number from the evidence that is supposed to support it.

    The emission factor is expressed per activity unit (`kgCO2e/kWh`), so no activity-unit
    conversion happens here: the factor already carries the unit. What the arithmetic does check
    is that the factor's denominator matches the claim's activity unit, which is the single most
    common real defect in a hand-maintained inventory.
    """
    defects: list[Defect] = []
    claim_id = str(claim.get("id", ""))

    index: dict[str, Document] = {}
    for document in documents:
        address = document.get("address")
        if isinstance(address, str):
            index[address] = document

    factor_address = str(claim.get("factorAddress", ""))
    factor_doc = index.get(factor_address)

    if factor_doc is None:
        defects.append({
            "code": "FACTOR_DOC_MISSING",
            "message": f"emission factor {factor_address or '(none)'} is not in the evidence set",
            "node": factor_address or claim_id,
        })

    # A document is superseded when some *other* document names it as the one being replaced.
    # Declaring that you supersede something is the opposite: it makes you the current revision.
    replaced: set[str] = set()
    for document in documents:
        target = document.get("supersedes")
        if isinstance(target, str) and target:
            replaced.add(target)

    factor_reports: list[FactorReport] = []
    for address in sorted(index):
        document = index[address]
        factor_reports.append({
            "address": address,
            "kind": str(document.get("kind", "")),
            "present": True,
            "trusted": bool(document.get("trusted", True)),
            "superseded": address in replaced,
        })

    if factor_doc is not None and factor_address in replaced:
        defects.append({
            "code": "FACTOR_DOC_SUPERSEDED",
            "message": f"emission factor {factor_address} has been replaced by a newer revision",
            "node": factor_address,
        })
    if factor_doc is not None and not bool(factor_doc.get("trusted", True)):
        defects.append({
            "code": "FACTOR_DOC_UNTRUSTED",
            "message": f"emission factor {factor_address} comes from an unaccepted source",
            "node": factor_address,
        })

    activity_unit = str(claim.get("activityUnit", ""))
    factor_unit = str(claim.get("factorUnit", ""))
    mass_unit, _, denominator = factor_unit.partition("/")

    if denominator and activity_unit and denominator != activity_unit:
        defects.append({
            "code": "UNIT_MISMATCH",
            "message": (
                f"factor is per {denominator!r} but the claim is measured in {activity_unit!r}"
            ),
            "node": claim_id,
        })
    if denominator == "":
        defects.append({
            "code": "UNIT_MISMATCH",
            "message": f"factor unit {factor_unit!r} is not expressed per activity unit",
            "node": claim_id,
        })

    mass_factor = MASS_UNITS.get(mass_unit)
    if mass_factor is None:
        defects.append({
            "code": "UNKNOWN_MASS_UNIT",
            "message": f"{mass_unit!r} is not a recognised mass unit of CO2e",
            "node": claim_id,
        })
        mass_factor = "0"

    with localcontext() as context:
        context.prec = PRECISION
        quantity = _decimal(claim.get("activityQuantity"), "activityQuantity", defects)
        factor_value = _decimal(claim.get("factorValue"), "factorValue", defects)
        reported = _decimal(claim.get("reportedTonnes"), "reportedTonnes", defects)
        uncertainty_pct = _decimal(claim.get("factorUncertaintyPct"), "factorUncertaintyPct", defects)

        kg = quantity * factor_value * Decimal(mass_factor)
        exact_tonnes = kg * Decimal(TONNES_PER_KG)
        rounded_tonnes = round_significant(exact_tonnes, sigfigs)
        residual = exact_tonnes - rounded_tonnes

        delta = rounded_tonnes - reported
        # Ratios are reported to 6 significant figures rather than the full 50-digit working
        # precision: the extra digits are division artefacts, and an auditor should not have to
        # read 48 of them. The rounding is itself deterministic.
        delta_pct = Decimal(0) if reported == 0 else round_significant(
            (delta / reported) * Decimal(100), 6
        )
        uncertainty = round_significant(
            abs(rounded_tonnes) * (abs(uncertainty_pct) / Decimal(100)), 6
        )
        within = abs(delta_pct) <= tolerance_pct

        computation: Computation = {
            "claimId": claim_id,
            "recomputedKg": _plain(kg),
            "recomputedTonnes": _plain(rounded_tonnes),
            "exactTonnes": _plain(exact_tonnes),
            "reportedTonnes": _plain(reported),
            "deltaTonnes": _plain(delta),
            "deltaPct": _plain(delta_pct),
            "uncertaintyTonnes": _plain(uncertainty),
            "roundingResidual": _plain(residual),
            "withinTolerance": bool(within),
            "tolerancePct": _plain(tolerance_pct),
            "sigFigs": sigfigs,
            "factors": factor_reports,
            "defects": sorted(defects, key=lambda d: (d["code"], d["node"])),
        }
    return computation


def _plain(value: Decimal) -> str:
    """Render a Decimal as a plain string — never scientific notation, which would make the
    JSON unreadable to a spreadsheet and unparseable by a naive consumer."""
    if value == 0:
        return "0"
    normalised = value.normalize()
    sign, digits, exponent = normalised.as_tuple()
    if isinstance(exponent, int) and exponent > 0:
        normalised = normalised.quantize(Decimal(1))
    text = format(normalised, "f")
    if text in {"-0", "-0.0"}:
        return "0"
    _ = sign, digits
    return text


# --------------------------------------------------------------------------- provenance walk


def walk_provenance(graph: Graph, root: str, budget: int) -> Walk:
    """Walk support from a claim to the evidence that grounds it.

    Three properties matter and each one has a corresponding failure mode the walk must report
    rather than hide:

    * **termination** — a support cycle means a claim ultimately rests on itself. Detected with
      an explicit stack, and the actual cycle path is reported so it can be fixed.
    * **boundedness** — provenance graphs fan out. A hard visit budget stops a small malformed
      graph from becoming an unbounded walk, and `budgetExhausted` makes the truncation visible
      instead of letting a partial answer look complete.
    * **honesty about replacement** — a document that a newer revision supersedes is still in the
      graph but is no longer usable support.
    """
    defects: list[Defect] = []
    nodes: dict[str, Node] = {}
    for node in graph.get("nodes", []):
        identifier = node.get("id")
        if isinstance(identifier, str):
            nodes[identifier] = node

    support: dict[str, list[str]] = {identifier: [] for identifier in nodes}
    replaced: set[str] = set()

    for edge in graph.get("edges", []):
        source = edge.get("from")
        target = edge.get("to")
        relation = edge.get("relation")
        if not isinstance(source, str) or not isinstance(target, str):
            continue
        if not isinstance(relation, str):
            continue
        if source not in nodes:
            defects.append({"code": "DANGLING_EDGE", "message": f"edge starts at unknown {source!r}",
                            "node": source})
            continue
        if target not in nodes:
            defects.append({"code": "DANGLING_EDGE", "message": f"edge points at unknown {target!r}",
                            "node": target})
            continue
        if relation in REPLACEMENT_RELATIONS:
            replaced.add(target)
        elif relation in SUPPORT_RELATIONS:
            support[source].append(target)

    for identifier in support:
        support[identifier].sort()

    if root not in nodes:
        defects.append({"code": "DANGLING_EDGE", "message": f"root {root!r} is not in the graph",
                        "node": root})
        return {
            "root": root, "visited": 0, "budget": budget, "budgetExhausted": False,
            "supportDepth": 0, "terminals": [], "paths": [], "pathsTruncated": False,
            "cycle": None,
            "defects": sorted(defects, key=lambda d: (d["code"], d["node"])),
        }

    seen: set[str] = set()
    on_stack: list[str] = []
    on_stack_set: set[str] = set()
    parent: dict[str, str] = {}
    terminals: list[Terminal] = []
    cycle: list[str] | None = None
    visited = 0
    budget_exhausted = False
    support_depth = 0

    # Explicit stack: (node, depth). Recursion would put a 10,000-node graph at the mercy of the
    # interpreter's stack limit, which is exactly the case the budget exists to survive.
    stack: list[tuple[str, int]] = [(root, 0)]

    while stack:
        identifier, depth = stack.pop()
        if cycle is not None or budget_exhausted:
            break

        # A node still on the stack means an edge points back into the current path: that is a
        # cycle. It must be checked before `seen`, or the back edge would have been pruned.
        if identifier in on_stack_set:
            start = on_stack.index(identifier)
            cycle = [*on_stack[start:], identifier]
            break

        if identifier in seen:
            continue

        visited += 1
        if visited > budget:
            budget_exhausted = True
            break

        seen.add(identifier)
        on_stack.append(identifier)
        on_stack_set.add(identifier)
        support_depth = max(support_depth, depth)

        # Vet every node the walk relies on, terminals included: an untrusted or superseded
        # document is a finding whether or not anything else descends from it.
        if not bool(nodes[identifier].get("trusted", True)):
            defects.append({"code": "UNTRUSTED_NODE", "message": f"{identifier!r} is not trusted",
                            "node": identifier})
        if identifier in replaced:
            defects.append({
                "code": "SUPERSEDED_NODE",
                "message": f"{identifier!r} was replaced by a newer revision but is still relied on",
                "node": identifier,
            })

        children = support.get(identifier, [])
        if not children:
            node = nodes[identifier]
            terminals.append({
                "id": identifier,
                "address": str(node.get("address", "")),
                "kind": str(node.get("kind", "")),
            })
            on_stack.pop()
            on_stack_set.discard(identifier)
            continue

        # Every child is pushed, including ones already seen: pruning here is exactly what would
        # hide a cycle. Already-explored nodes are discarded when they are popped.
        for child in reversed(children):
            if child not in seen and child not in parent:
                parent[child] = identifier
            stack.append((child, depth + 1))

    on_stack.clear()
    on_stack_set.clear()

    if cycle is not None:
        defects.append({
            "code": "CYCLE_DETECTED",
            "message": "circular provenance: " + " -> ".join(cycle),
            "node": cycle[0],
        })
    if budget_exhausted:
        defects.append({
            "code": "BUDGET_EXHAUSTED",
            "message": f"support walk stopped after {budget} visits; the chain is longer than the budget",
            "node": root,
        })

    terminals.sort(key=lambda t: (t["address"], t["id"]))

    # Reconstruct one root-to-terminal chain per terminal from the parent pointers recorded
    # during the walk, so a reader can be shown the actual path rather than a bare depth number.
    paths: list[list[str]] = []
    for terminal in terminals:
        if len(paths) >= MAX_PATHS:
            break
        chain = [terminal["id"]]
        cursor = terminal["id"]
        while cursor in parent:
            cursor = parent[cursor]
            chain.append(cursor)
        paths.append(list(reversed(chain)))
    paths_truncated = len(terminals) > MAX_PATHS

    return {
        "root": root,
        "visited": visited,
        "budget": budget,
        "budgetExhausted": budget_exhausted,
        "supportDepth": support_depth,
        "terminals": terminals,
        "paths": paths,
        "pathsTruncated": paths_truncated,
        "cycle": cycle,
        "defects": sorted(defects, key=lambda d: (d["code"], d["node"])),
    }


# --------------------------------------------------------------------------- verdict


def forge_verdict(
    claim: Claim,
    documents: list[Document],
    graph: Graph,
    root: str,
    budget: int,
    sigfigs: int,
    tolerance_pct: Decimal,
) -> Verdict:
    """Fold the arithmetic and the provenance walk into one status, and seal it.

    Status precedence is circular > unsupported > unverified > supported, because the first
    three each invalidate the question the fourth would answer: a claim whose provenance loops
    cannot be verified no matter how well its arithmetic checks out.
    """
    computation = recompute_claim(claim, documents, sigfigs, tolerance_pct)
    walk = walk_provenance(graph, root, budget)

    reasons: list[str] = []
    for defect in [*computation["defects"], *walk["defects"]]:
        if defect["code"] in BLOCKING:
            reasons.append(f"{defect['code']}: {defect['message']}")

    if not computation["withinTolerance"]:
        reasons.append(
            "DELTA_OVER_TOLERANCE: reported "
            f"{computation['reportedTonnes']} tCO2e but the evidence gives "
            f"{computation['recomputedTonnes']} tCO2e "
            f"({computation['deltaPct']}% > {computation['tolerancePct']}%)"
        )

    if walk["cycle"] is not None:
        status = "circular"
    elif reasons:
        status = "unsupported"
    elif walk["budgetExhausted"] or walk["supportDepth"] == 0 or not walk["terminals"]:
        status = "unverified"
        if not reasons:
            reasons.append("UNVERIFIED: the claim reaches no terminal evidence")
    else:
        status = "supported"

    verdict: Verdict = {
        "claimId": computation["claimId"],
        "status": status,
        "reasons": sorted(set(reasons)),
        "computation": computation,
        "walk": walk,
        "seal": seal_of(computation, walk, status),
        "engine": ENGINE_NAME,
    }
    return verdict


def seal_of(computation: Computation, walk: Walk, status: str) -> str:
    """A content address over the verdict's substance.

    Keyed on the findings rather than on a timestamp, so re-forging an unchanged claim returns
    the same seal. Two runs agreeing on a seal is the check an auditor can actually perform.
    """
    payload = {
        "status": status,
        "claimId": computation["claimId"],
        "recomputedTonnes": computation["recomputedTonnes"],
        "reportedTonnes": computation["reportedTonnes"],
        "withinTolerance": computation["withinTolerance"],
        "defects": sorted(
            [*(d["code"] for d in computation["defects"]), *(d["code"] for d in walk["defects"])]
        ),
        "terminals": sorted(t["address"] for t in walk["terminals"]),
    }
    encoded = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return f"sha256:{hashlib.sha256(encoded).hexdigest()}"


# --------------------------------------------------------------------------- operation entry points


def _collect(payload: dict[str, Any]) -> tuple[Claim, list[Document], Graph]:
    claim = _obj(payload, "claim")
    documents = _obj_list(payload, "documents")
    graph = _obj(payload, "graph")
    return claim, documents, graph  # type: ignore[return-value]


def op_recompute(payload: Any) -> Computation:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "expected an object with 'claim'")
    claim = _obj(payload, "claim")
    documents = _obj_list(payload, "documents")
    sigfigs = _clamped_int(payload, "sigFigs", DEFAULT_SIGFIGS, MIN_SIGFIGS, MAX_SIGFIGS)
    defects: list[Defect] = []
    tolerance = _decimal(payload.get("tolerancePct", DEFAULT_TOLERANCE_PCT), "tolerancePct", defects)
    if defects:
        raise EngineError("NOT_A_DECIMAL", defects[0]["message"])
    return recompute_claim(claim, documents, sigfigs, tolerance)  # type: ignore[arg-type]


def op_walk(payload: Any) -> Walk:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "expected an object with 'graph'")
    graph = _obj(payload, "graph")
    root = payload.get("root")
    if not isinstance(root, str) or not root:
        raise EngineError("MISSING_FIELD", "'root' is required and must be a non-empty string")
    budget = _clamped_int(payload, "budget", DEFAULT_BUDGET, 1, 1_000_000)
    return walk_provenance(graph, root, budget)  # type: ignore[arg-type]


def op_forge(payload: Any) -> Verdict:
    if not isinstance(payload, dict):
        raise EngineError("BAD_SHAPE", "expected an object with 'claim'")
    claim, documents, graph = _collect(payload)
    root = payload.get("root")
    if not isinstance(root, str) or not root:
        root = str(claim.get("id", ""))
    budget = _clamped_int(payload, "budget", DEFAULT_BUDGET, 1, 1_000_000)
    sigfigs = _clamped_int(payload, "sigFigs", DEFAULT_SIGFIGS, MIN_SIGFIGS, MAX_SIGFIGS)
    defects: list[Defect] = []
    tolerance = _decimal(payload.get("tolerancePct", DEFAULT_TOLERANCE_PCT), "tolerancePct", defects)
    if defects:
        raise EngineError("NOT_A_DECIMAL", defects[0]["message"])
    return forge_verdict(  # type: ignore[arg-type]
        claim, documents, graph, root, budget, sigfigs, tolerance
    )


FORGE_OPERATIONS: Final[dict[str, Any]] = {
    "recompute": op_recompute,
    "walk": op_walk,
    "forge": op_forge,
}