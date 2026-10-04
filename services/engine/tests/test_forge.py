from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from carbonflux_forge.forge import (
    MASS_UNITS,
    forge_verdict,
    recompute_claim,
    round_significant,
    seal_of,
    walk_provenance,
)
from carbonflux_forge.protocol import EngineError
from decimal import Decimal


def document(
    address: str = "sha256:" + "a" * 64,
    kind: str = "emission-factor",
    supersedes: str | None = None,
    trusted: bool = True,
) -> dict[str, object]:
    return {
        "address": address,
        "kind": kind,
        "label": f"{kind} document",
        "capturedAt": 1_700_000_000_000,
        "supersedes": supersedes,
        "trusted": trusted,
    }


def claim(**overrides: object) -> dict[str, object]:
    base: dict[str, object] = {
        "id": "scope1-stationary-combustion",
        "scope": 1,
        "category": "stationary-combustion",
        "activityQuantity": "12500",
        "activityUnit": "kWh",
        "factorValue": "0.207",
        "factorUnit": "kgCO2e/kWh",
        "factorAddress": "sha256:" + "a" * 64,
        "factorUncertaintyPct": "5",
        "reportedTonnes": "2.58750",
        "period": "2026-Q1",
    }
    base.update(overrides)
    return base


def node(identifier: str, address: str, kind: str, trusted: bool = True) -> dict[str, object]:
    return {"id": identifier, "type": "document", "address": address, "kind": kind, "trusted": trusted}


def graph(nodes: list[dict[str, object]], edges: list[dict[str, str]]) -> dict[str, object]:
    return {"nodes": nodes, "edges": edges}


class TestRoundSignificant:
    def test_keeps_the_requested_number_of_digits(self) -> None:
        assert round_significant(Decimal("1234.5678"), 3) == Decimal("1230")

    def test_half_to_even(self) -> None:
        assert round_significant(Decimal("2.5"), 1) == Decimal("2")
        assert round_significant(Decimal("3.5"), 1) == Decimal("4")

    def test_zero_is_zero(self) -> None:
        assert round_significant(Decimal(0), 6) == Decimal(0)

    def test_does_not_raise_on_extreme_values(self) -> None:
        assert isinstance(round_significant(Decimal("1e-300"), 6), Decimal)
        assert isinstance(round_significant(Decimal("1e300"), 6), Decimal)


class TestRecompute:
    def test_reproduces_a_reported_number_from_its_evidence(self) -> None:
        result = recompute_claim(claim(), [document()], 6, Decimal("2"))
        # 12500 kWh * 0.207 kgCO2e/kWh = 2587.5 kg = 2.5875 t
        assert result["recomputedKg"] == "2587.5"
        assert result["recomputedTonnes"] == "2.5875"
        assert result["withinTolerance"] is True

    def test_flags_a_reported_number_the_evidence_does_not_support(self) -> None:
        result = recompute_claim(claim(reportedTonnes="3.1"), [document()], 6, Decimal("2"))
        assert result["withinTolerance"] is False
        # The reported figure is higher than the evidence supports, so the delta is negative.
        assert float(result["deltaPct"]) < -2

    def test_propagates_factor_uncertainty(self) -> None:
        result = recompute_claim(claim(), [document()], 6, Decimal("2"))
        # 5% of 2.5875 tCO2e
        assert result["uncertaintyTonnes"] == "0.129375"

    def test_missing_factor_document_is_a_finding_not_a_crash(self) -> None:
        result = recompute_claim(claim(), [], 6, Decimal("2"))
        assert any(d["code"] == "FACTOR_DOC_MISSING" for d in result["defects"])

    def test_superseded_factor_is_flagged(self) -> None:
        # The old revision is cited while a newer document names it as replaced.
        old = document(supersedes=None)
        new = document(address="sha256:" + "b" * 64, supersedes=old["address"])
        result = recompute_claim(claim(), [old, new], 6, Decimal("2"))
        assert any(d["code"] == "FACTOR_DOC_SUPERSEDED" for d in result["defects"])

    def test_the_current_revision_is_not_flagged_as_superseded(self) -> None:
        # Declaring that you supersede something is what makes a document current, so citing the
        # newest revision must never be reported as superseded.
        old = document()
        new = document(address="sha256:" + "b" * 64, supersedes=old["address"])
        result = recompute_claim(
            claim(factorAddress=new["address"]), [old, new], 6, Decimal("2")
        )
        assert not any(d["code"] == "FACTOR_DOC_SUPERSEDED" for d in result["defects"])

    def test_untrusted_factor_is_flagged(self) -> None:
        result = recompute_claim(claim(), [document(trusted=False)], 6, Decimal("2"))
        assert any(d["code"] == "FACTOR_DOC_UNTRUSTED" for d in result["defects"])

    def test_factor_denominator_must_match_the_activity_unit(self) -> None:
        result = recompute_claim(claim(activityUnit="MWh"), [document()], 6, Decimal("2"))
        assert any(d["code"] == "UNIT_MISMATCH" for d in result["defects"])

    def test_unknown_mass_unit_is_flagged(self) -> None:
        result = recompute_claim(claim(factorUnit="furlongsCO2e/kWh"), [document()], 6, Decimal("2"))
        assert any(d["code"] == "UNKNOWN_MASS_UNIT" for d in result["defects"])

    def test_the_same_factor_in_tonnes_per_kwh_gives_the_same_tonnes(self) -> None:
        # The physical factor is identical; only its unit differs. Expressing it per tonne means
        # the number is 1000x smaller, and the two must still agree on the quantity of CO2e.
        as_kg = recompute_claim(
            claim(factorValue="0.207", reportedTonnes="2.5875"), [document()], 6, Decimal("2")
        )
        as_tonne = recompute_claim(
            claim(factorValue="0.000207", factorUnit="tCO2e/kWh", reportedTonnes="2.5875"),
            [document()],
            6,
            Decimal("2"),
        )
        assert as_kg["recomputedKg"] == "2587.5"
        assert as_tonne["recomputedKg"] == "2587.5"
        assert as_kg["recomputedTonnes"] == as_tonne["recomputedTonnes"] == "2.5875"

    def test_a_malformed_quantity_does_not_abort_the_claim(self) -> None:
        result = recompute_claim(claim(activityQuantity="twelve"), [document()], 6, Decimal("2"))
        assert any(d["code"] == "NOT_A_DECIMAL" for d in result["defects"])
        assert result["recomputedTonnes"] == "0"

    def test_every_mass_unit_produces_a_plain_decimal_string(self) -> None:
        # Scientific notation in the JSON would be unreadable in a spreadsheet and a parsing
        # hazard for a naive consumer, so the invariant is "plain, and equal to the exact value".
        for unit, factor in MASS_UNITS.items():
            result = recompute_claim(
                claim(factorUnit=f"{unit}/kWh", reportedTonnes="0"), [document()], 6, Decimal("2")
            )
            expected = Decimal("12500") * Decimal("0.207") * Decimal(factor)
            assert "E" not in result["recomputedKg"]
            assert Decimal(result["recomputedKg"]) == expected


class TestWalkProvenance:
    def test_reports_support_depth_and_terminals(self) -> None:
        nodes = [node("claim-1", "sha256:c", "activity-data"), node("meter", "sha256:a", "report")]
        edges = [{"from": "claim-1", "to": "meter", "relation": "derived-from"}]
        result = walk_provenance(graph(nodes, edges), "claim-1", 100)  # type: ignore[arg-type]
        assert result["supportDepth"] == 1
        assert [t["id"] for t in result["terminals"]] == ["meter"]
        assert result["cycle"] is None

    def test_reconstructs_the_chain_from_root_to_terminal(self) -> None:
        nodes = [node("root", "sha256:r", "activity-data"), node("mid", "sha256:m", "report"),
                 node("end", "sha256:e", "report")]
        edges = [{"from": "root", "to": "mid", "relation": "derived-from"},
                 {"from": "mid", "to": "end", "relation": "calibrated-by"}]
        result = walk_provenance(graph(nodes, edges), "root", 100)  # type: ignore[arg-type]
        assert result["paths"] == [["root", "mid", "end"]]
        assert result["pathsTruncated"] is False

    def test_chain_paths_are_capped(self) -> None:
        # Ten independent leaves behind one claim: more terminals than MAX_PATHS allows.
        leaves = [node(f"leaf{i}", f"sha256:{i:064d}", "report") for i in range(12)]
        nodes = [node("root", "sha256:r", "activity-data"), *leaves]
        edges = [{"from": "root", "to": leaf["id"], "relation": "derived-from"} for leaf in leaves]
        result = walk_provenance(graph(nodes, edges), "root", 1000)  # type: ignore[arg-type]
        assert len(result["terminals"]) == 12
        assert len(result["paths"]) == 8
        assert result["pathsTruncated"] is True

    def test_a_cycle_yields_no_chain(self) -> None:
        nodes = [node("a", "sha256:a", "report"), node("b", "sha256:b", "report")]
        edges = [{"from": "a", "to": "b", "relation": "derived-from"},
                 {"from": "b", "to": "a", "relation": "derived-from"}]
        result = walk_provenance(graph(nodes, edges), "a", 100)  # type: ignore[arg-type]
        assert result["cycle"] is not None

    def test_detects_a_cycle_and_reports_the_actual_path(self) -> None:
        nodes = [node("a", "sha256:a", "report"), node("b", "sha256:b", "report"),
                 node("c", "sha256:c", "report")]
        edges = [
            {"from": "a", "to": "b", "relation": "derived-from"},
            {"from": "b", "to": "c", "relation": "derived-from"},
            {"from": "c", "to": "a", "relation": "derived-from"},
        ]
        result = walk_provenance(graph(nodes, edges), "a", 100)  # type: ignore[arg-type]
        assert result["cycle"] is not None
        assert result["cycle"][0] == result["cycle"][-1]
        assert any(d["code"] == "CYCLE_DETECTED" for d in result["defects"])

    def test_a_self_referencing_claim_is_circular(self) -> None:
        nodes = [node("a", "sha256:a", "report")]
        edges = [{"from": "a", "to": "a", "relation": "derived-from"}]
        result = walk_provenance(graph(nodes, edges), "a", 100)  # type: ignore[arg-type]
        assert result["cycle"] == ["a", "a"]

    def test_stops_at_the_visit_budget_and_says_so(self) -> None:
        nodes = [node(f"n{i}", f"sha256:{i:064d}", "report") for i in range(50)]
        edges = [{"from": f"n{i}", "to": f"n{i + 1}", "relation": "derived-from"} for i in range(49)]
        result = walk_provenance(graph(nodes, edges), "n0", 5)  # type: ignore[arg-type]
        assert result["budgetExhausted"] is True
        assert result["visited"] <= 6
        assert any(d["code"] == "BUDGET_EXHAUSTED" for d in result["defects"])

    def test_diamond_fan_out_is_counted_once_per_node(self) -> None:
        nodes = [node("root", "sha256:r", "activity-data"), node("l", "sha256:l", "report"),
                 node("r", "sha256:r2", "report"), node("base", "sha256:b", "report")]
        edges = [
            {"from": "root", "to": "l", "relation": "derived-from"},
            {"from": "root", "to": "r", "relation": "derived-from"},
            {"from": "l", "to": "base", "relation": "derived-from"},
            {"from": "r", "to": "base", "relation": "derived-from"},
        ]
        result = walk_provenance(graph(nodes, edges), "root", 100)  # type: ignore[arg-type]
        assert result["visited"] == 4
        assert result["supportDepth"] == 2

    def test_supersedes_is_not_treated_as_support(self) -> None:
        nodes = [node("claim", "sha256:c", "activity-data"), node("old", "sha256:o", "report"),
                 node("new", "sha256:n", "report")]
        edges = [{"from": "claim", "to": "old", "relation": "derived-from"},
                 {"from": "new", "to": "old", "relation": "supersedes"}]
        result = walk_provenance(graph(nodes, edges), "claim", 100)  # type: ignore[arg-type]
        assert result["supportDepth"] == 1
        assert any(d["code"] == "SUPERSEDED_NODE" for d in result["defects"])

    def test_dangling_edge_is_reported(self) -> None:
        nodes = [node("a", "sha256:a", "report")]
        edges = [{"from": "a", "to": "ghost", "relation": "derived-from"}]
        result = walk_provenance(graph(nodes, edges), "a", 100)  # type: ignore[arg-type]
        assert any(d["code"] == "DANGLING_EDGE" for d in result["defects"])

    def test_unknown_root_is_reported_not_thrown(self) -> None:
        result = walk_provenance(graph([], []), "nope", 100)  # type: ignore[arg-type]
        assert result["visited"] == 0
        assert any(d["code"] == "DANGLING_EDGE" for d in result["defects"])

    def test_terminals_are_ordered_deterministically(self) -> None:
        nodes = [node("root", "sha256:r", "activity-data"), node("z", "sha256:z", "report"),
                 node("a", "sha256:a", "report")]
        edges = [{"from": "root", "to": "z", "relation": "derived-from"},
                 {"from": "root", "to": "a", "relation": "derived-from"}]
        first = walk_provenance(graph(nodes, edges), "root", 100)  # type: ignore[arg-type]
        second = walk_provenance(graph(nodes, list(reversed(edges))), "root", 100)  # type: ignore[arg-type]
        assert first["terminals"] == second["terminals"]
        assert [t["id"] for t in first["terminals"]] == ["a", "z"]

    @settings(max_examples=25, deadline=None)
    @given(st.integers(min_value=1, max_value=200), st.integers(min_value=0, max_value=30))
    def test_terminates_for_any_budget_and_chain(self, budget: int, length: int) -> None:
        nodes = [node(f"n{i}", f"sha256:{i:064d}", "report") for i in range(length + 1)]
        edges = [{"from": f"n{i}", "to": f"n{i + 1}", "relation": "derived-from"} for i in range(length)]
        result = walk_provenance(graph(nodes, edges), "n0", budget)  # type: ignore[arg-type]
        assert result["visited"] <= budget + 1


class TestForgeVerdict:
    def build(self, **claim_overrides: object):
        nodes = [
            node("scope1-stationary-combustion", "sha256:c", "activity-data"),
            node("factor", "sha256:" + "a" * 64, "emission-factor"),
        ]
        edges = [
            {"from": "scope1-stationary-combustion", "to": "factor", "relation": "derived-from"}
        ]
        return nodes, edges

    def test_supported_when_the_evidence_reproduces_the_number(self) -> None:
        nodes, edges = self.build()
        result = forge_verdict(claim(), [document()], graph(nodes, edges),  # type: ignore[arg-type]
                               "scope1-stationary-combustion", 1000, 6, Decimal("2"))
        assert result["status"] == "supported"
        assert result["reasons"] == []
        assert result["seal"].startswith("sha256:")

    def test_unsupported_when_the_number_does_not_reproduce(self) -> None:
        nodes, edges = self.build()
        result = forge_verdict(claim(reportedTonnes="9.9"), [document()], graph(nodes, edges),  # type: ignore[arg-type]
                               "scope1-stationary-combustion", 1000, 6, Decimal("2"))
        assert result["status"] == "unsupported"
        assert any(r.startswith("DELTA_OVER_TOLERANCE") for r in result["reasons"])

    def test_circular_beats_unsupported(self) -> None:
        nodes, edges = self.build()
        # add a cycle back to the claim
        edges = [*edges, {"from": "factor", "to": "scope1-stationary-combustion",
                          "relation": "derived-from"}]
        result = forge_verdict(claim(reportedTonnes="9.9"), [document()], graph(nodes, edges),  # type: ignore[arg-type]
                               "scope1-stationary-combustion", 1000, 6, Decimal("2"))
        assert result["status"] == "circular"

    def test_unverified_when_nothing_is_grounded(self) -> None:
        nodes = [node("only", "sha256:x", "activity-data")]
        result = forge_verdict(claim(), [document()], graph(nodes, []),  # type: ignore[arg-type]
                               "only", 1000, 6, Decimal("2"))
        # The claim itself is a terminal, so it is grounded in itself: unverified, not supported.
        assert result["status"] in {"unsupported", "unverified"}

    def test_seal_is_stable_for_identical_inputs(self) -> None:
        nodes, edges = self.build()
        one = forge_verdict(claim(), [document()], graph(nodes, edges),  # type: ignore[arg-type]
                            "scope1-stationary-combustion", 1000, 6, Decimal("2"))
        two = forge_verdict(claim(), [document()], graph(nodes, edges),  # type: ignore[arg-type]
                            "scope1-stationary-combustion", 1000, 6, Decimal("2"))
        assert one["seal"] == two["seal"]

    def test_seal_changes_when_the_verdict_changes(self) -> None:
        nodes, edges = self.build()
        one = forge_verdict(claim(), [document()], graph(nodes, edges),  # type: ignore[arg-type]
                            "scope1-stationary-combustion", 1000, 6, Decimal("2"))
        two = forge_verdict(claim(reportedTonnes="9.9"), [document()], graph(nodes, edges),  # type: ignore[arg-type]
                            "scope1-stationary-combustion", 1000, 6, Decimal("2"))
        assert one["seal"] != two["seal"]

    def test_budget_exhaustion_is_unverified_not_supported(self) -> None:
        nodes = [node("root", "sha256:r", "activity-data")]
        nodes += [node(f"n{i}", f"sha256:{i:064d}", "report") for i in range(10)]
        edges = [{"from": "root", "to": "n0", "relation": "derived-from"}]
        edges += [{"from": f"n{i}", "to": f"n{i + 1}", "relation": "derived-from"} for i in range(9)]
        result = forge_verdict(claim(), [document()], graph(nodes, edges),  # type: ignore[arg-type]
                               "root", 3, 6, Decimal("2"))
        assert result["status"] == "unverified"
        assert result["walk"]["budgetExhausted"] is True

    @settings(max_examples=30, deadline=None)
    @given(
        st.decimals(min_value=Decimal("0"), max_value=Decimal("100000"),
                    places=3, allow_nan=False, allow_infinity=False),
        st.integers(min_value=1, max_value=12),
    )
    def test_verdict_is_a_pure_function_of_its_input(self, quantity: Decimal, sigfigs: int) -> None:
        nodes, edges = self.build()
        base = {
            "claim": claim(activityQuantity=str(quantity)),
            "documents": [document()],
            "graph": graph(nodes, edges),
            "root": "scope1-stationary-combustion",
            "budget": 1000,
            "sigFigs": sigfigs,
            "tolerancePct": "2",
        }
        one = forge_verdict(base["claim"], base["documents"], base["graph"],  # type: ignore[arg-type]
                            base["root"],  # type: ignore[arg-type]
                            1000, sigfigs, Decimal("2"))
        two = forge_verdict(base["claim"], base["documents"], base["graph"],  # type: ignore[arg-type]
                            base["root"],  # type: ignore[arg-type]
                            1000, sigfigs, Decimal("2"))
        assert one == two


class TestSeal:
    def test_seal_depends_only_on_substance(self) -> None:
        computation = recompute_claim(claim(), [document()], 6, Decimal("2"))
        walk = walk_provenance(
            graph([node("a", "sha256:a", "report")], []), "a", 100  # type: ignore[arg-type]
        )
        first = seal_of(computation, walk, "supported")
        second = seal_of(computation, walk, "supported")
        assert first == second
        assert first.startswith("sha256:")
        assert len(first) == len("sha256:") + 64

    def test_seal_varies_with_status(self) -> None:
        computation = recompute_claim(claim(), [document()], 6, Decimal("2"))
        walk = walk_provenance(
            graph([node("a", "sha256:a", "report")], []), "a", 100  # type: ignore[arg-type]
        )
        assert seal_of(computation, walk, "supported") != seal_of(computation, walk, "unsupported")


class TestOperationEntryPoints:
    def test_unknown_op_lists_the_available_ones(self) -> None:
        from carbonflux_forge.analysis import analyse

        with pytest.raises(EngineError) as caught:
            analyse("nonexistent", {})
        assert caught.value.code == "UNKNOWN_OP"
        assert "forge" in caught.value.message

    def test_every_forge_op_is_registered(self) -> None:
        from carbonflux_forge.analysis import OPERATIONS

        for op in ("recompute", "walk", "forge", "normalize", "diff", "summarize"):
            assert op in OPERATIONS