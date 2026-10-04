from __future__ import annotations

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from carbonflux_forge.analysis import diff, normalize, summarize
from carbonflux_forge.protocol import EngineError


def record(identifier: str = "a", kind: str = "note", **payload: object) -> dict[str, object]:
    return {
        "id": identifier,
        "kind": kind,
        "payload": dict(payload),
        "createdAt": 1,
        "updatedAt": 2,
    }


class TestNormalize:
    def test_returns_records_sorted_by_kind_then_id(self) -> None:
        result = normalize({"records": [record("b", "zebra"), record("a", "apple")]})
        assert [(r["kind"], r["id"]) for r in result["records"]] == [("apple", "a"), ("zebra", "b")]

    def test_payload_keys_are_sorted(self) -> None:
        result = normalize({"records": [record(b=2, a=1)]})
        assert list(result["records"][0]["fields"]) == ["a", "b"]

    def test_empty_input(self) -> None:
        assert normalize({"records": []}) == {"records": [], "kinds": [], "count": 0}

    def test_rejects_a_non_list(self) -> None:
        with pytest.raises(EngineError) as caught:
            normalize({"records": "nope"})  # type: ignore[arg-type]
        assert caught.value.code == "BAD_SHAPE"

    def test_rejects_a_missing_field(self) -> None:
        broken = record()
        del broken["updatedAt"]
        with pytest.raises(EngineError) as caught:
            normalize({"records": [broken]})  # type: ignore[list-item]
        assert caught.value.code == "MISSING_FIELD"

    @settings(max_examples=50, deadline=None)
    @given(st.lists(st.builds(record), max_size=12))
    def test_is_order_independent(self, records: list[dict[str, object]]) -> None:
        forward = normalize({"records": records})
        backward = normalize({"records": list(reversed(records))})
        assert forward == backward


class TestDiff:
    def test_detects_added_removed_changed_and_unchanged(self) -> None:
        before = [record("keep"), record("gone"), record("edit", v=1)]
        after = [record("keep"), record("edit", v=2), record("new")]
        result = diff({"before": before, "after": after})
        assert result["added"] == ["new"]
        assert result["removed"] == ["gone"]
        assert result["unchanged"] == 1
        assert result["changed"] == [{"id": "edit", "kind": "note", "change": "modified",
                                      "fields": ["v"]}]

    def test_both_empty(self) -> None:
        assert diff({"before": [], "after": []}) == {
            "added": [], "removed": [], "changed": [], "unchanged": 0}

    def test_reports_a_key_added_within_a_changed_record(self) -> None:
        result = diff({"before": [record("x", a=1)], "after": [record("x", a=1, b=2)]})
        assert result["changed"][0]["fields"] == ["b"]


class TestSummarize:
    def test_counts_by_kind(self) -> None:
        result = summarize({"records": [record("a", "x"), record("b", "x"), record("c", "y")]})
        assert result == {"total": 3, "byKind": {"x": 2, "y": 1}, "oldest": 2, "newest": 2}

    def test_empty_is_zeroed(self) -> None:
        assert summarize({"records": []}) == {
            "total": 0, "byKind": {}, "oldest": 0, "newest": 0}
