#!/usr/bin/env python3
"""
scripts/dedup_text_records.py
------------------------------
One-shot deduplication of all TextRecord rows across every dataset.

Rule
----
For each (dataset_id, original_text) group with more than one row:
  - KEEP the annotated record (is_annotated=True) if one exists.
    If multiple annotated rows exist, keep the one with the lowest id.
  - If NO row is annotated, keep the one with the lowest id.
  - DELETE all other rows in the group.

Cascade behaviour
-----------------
TextRecord has a cascade relationship to BRRecordStage (passive_deletes=True /
ondelete=CASCADE in the FK).  Deleting a TextRecord will therefore also
remove its associated BRRecordStage rows.

Usage
-----
    conda activate datasupport
    PYTHONPATH=. python scripts/dedup_text_records.py [--dry-run]
"""

import sys
import argparse
from collections import defaultdict

# Ensure project root is on path
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.database import SessionLocal
from backend.models import TextRecord, TextDataset
import backend.br_pipeline_models  # noqa: F401 — registers BRPipelineRun with SQLAlchemy mapper


def dedup_dataset(db, dataset: TextDataset, dry_run: bool) -> tuple[int, int]:
    """
    Deduplicate records within a single dataset.
    Returns (records_kept, records_deleted).
    """
    records = (
        db.query(TextRecord)
        .filter(TextRecord.dataset_id == dataset.id)
        .order_by(TextRecord.id)
        .all()
    )

    # Group by normalised original_text (strip whitespace for safety)
    groups: dict[str, list[TextRecord]] = defaultdict(list)
    for r in records:
        key = (r.original_text or "").strip()
        groups[key].append(r)

    to_delete: list[TextRecord] = []

    for text, group in groups.items():
        if len(group) == 1:
            continue  # no duplicates

        # Choose keeper: prefer annotated; among annotated prefer lowest id
        annotated = [r for r in group if r.is_annotated]
        if annotated:
            keeper = min(annotated, key=lambda r: r.id)
        else:
            keeper = min(group, key=lambda r: r.id)

        for r in group:
            if r.id != keeper.id:
                to_delete.append(r)

    if to_delete:
        print(
            f"  Dataset [{dataset.id}] '{dataset.name}': "
            f"deleting {len(to_delete)} duplicate(s) "
            f"{'(dry-run)' if dry_run else ''}"
        )
        for r in to_delete:
            annotated_marker = "✓ annotated" if r.is_annotated else "  unannotated"
            print(f"    DELETE id={r.id} [{annotated_marker}]  text={r.original_text[:60]!r}")
            if not dry_run:
                db.delete(r)

        if not dry_run:
            db.commit()
    else:
        print(f"  Dataset [{dataset.id}] '{dataset.name}': no duplicates found.")

    kept = len(records) - len(to_delete)
    return kept, len(to_delete)


def main():
    parser = argparse.ArgumentParser(description="Deduplicate TextRecords across all datasets.")
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print what would be deleted without actually deleting anything."
    )
    args = parser.parse_args()

    if args.dry_run:
        print("=== DRY RUN — no changes will be written ===\n")

    db = SessionLocal()
    try:
        datasets = db.query(TextDataset).order_by(TextDataset.id).all()
        print(f"Found {len(datasets)} dataset(s).\n")

        total_kept = 0
        total_deleted = 0

        for dataset in datasets:
            kept, deleted = dedup_dataset(db, dataset, dry_run=args.dry_run)
            total_kept += kept
            total_deleted += deleted

        print(
            f"\n{'[DRY RUN] Would have deleted' if args.dry_run else 'Deleted'} "
            f"{total_deleted} duplicate record(s) across all datasets. "
            f"{total_kept} record(s) retained."
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
