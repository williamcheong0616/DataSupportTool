#!/usr/bin/env python3
"""
scripts/cleanup_empty_records.py
----------------------------------
Remove TextRecord rows (and their cascaded BRRecordStage rows) where BOTH
conditions are true:

  1. TextRecord.original_text == ""  (empty string, not NULL)
  2. Every associated BRRecordStage.restructured_text == ""  (empty string)

Records are KEPT if:
  - original_text is non-empty, OR
  - Any associated BRRecordStage has a non-empty restructured_text, OR
  - A BRRecordStage.restructured_text is NULL (restructuring not yet run —
    NULL means "not set", which is different from an explicit empty string)

Cascade behaviour
-----------------
TextRecord → BRRecordStage has cascade="all, delete-orphan" with
ondelete=CASCADE on the FK, so deleting a TextRecord automatically removes
all its BRRecordStage rows.

Usage
-----
    conda activate datasupport
    PYTHONPATH=. python scripts/cleanup_empty_records.py            # dry-run (safe)
    PYTHONPATH=. python scripts/cleanup_empty_records.py --execute  # commit deletions
"""

import sys
import argparse
from collections import defaultdict
from typing import Dict, List

sys.path.insert(0, ".")

from sqlalchemy import text
from backend.database import SessionLocal
from backend.models import TextDataset, TextRecord
from backend.br_pipeline_models import BRRecordStage  # noqa: F401 — needed for relationship resolution


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments.

    Returns:
        Parsed namespace with --execute flag.
    """
    parser = argparse.ArgumentParser(
        description="Delete TextRecord rows where both original_text and all "
                    "restructured_text values are empty strings."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        default=False,
        help="Actually commit deletions. Without this flag the script is a dry-run.",
    )
    return parser.parse_args()


def find_empty_record_ids(db) -> List[int]:
    """Identify TextRecord ids eligible for deletion.

    A TextRecord is eligible when:
      - original_text == "" (explicit empty string)
      - It has at least one BRRecordStage AND every one of those stages has
        restructured_text == "" (explicit empty string, not NULL)

    Args:
        db: SQLAlchemy session.

    Returns:
        List[int]: TextRecord.id values to delete.
    """
    # Candidate records: original_text is explicitly empty
    candidates = (
        db.query(TextRecord)
        .filter(TextRecord.original_text == "")
        .all()
    )

    to_delete = []
    for record in candidates:
        stages = record.br_record_stages

        # No pipeline stages at all → no restructured_text to evaluate; skip
        if not stages:
            continue

        # Keep if ANY stage has non-empty restructured_text (including NULL → not set)
        has_content = any(
            s.restructured_text is not None and s.restructured_text != ""
            for s in stages
        )
        if has_content:
            continue

        # All stages have restructured_text == "" (NULL stages would have been caught above)
        all_empty = all(
            s.restructured_text is not None and s.restructured_text == ""
            for s in stages
        )
        if all_empty:
            to_delete.append(record.id)

    return to_delete


def build_preview(db, record_ids: List[int]) -> None:
    """Print a per-dataset summary of records that will be deleted.

    Args:
        db: SQLAlchemy session.
        record_ids: TextRecord ids targeted for deletion.
    """
    if not record_ids:
        print("No records matched the deletion criteria.")
        return

    # Group by dataset
    by_dataset: Dict[int, List[int]] = defaultdict(list)
    records = db.query(TextRecord).filter(TextRecord.id.in_(record_ids)).all()
    for r in records:
        by_dataset[r.dataset_id].append(r.id)

    dataset_names = {
        ds.id: ds.name
        for ds in db.query(TextDataset)
        .filter(TextDataset.id.in_(by_dataset.keys()))
        .all()
    }

    print(f"\n{'=' * 60}")
    print(f"  Records eligible for deletion: {len(record_ids)}")
    print(f"{'=' * 60}")
    print(f"  {'Dataset':<35} {'Dataset ID':>10}  {'Records':>7}")
    print(f"  {'-' * 55}")
    for ds_id, ids in sorted(by_dataset.items()):
        ds_name = dataset_names.get(ds_id, "<unknown>")
        print(f"  {ds_name:<35} {ds_id:>10}  {len(ids):>7}")
    print(f"{'=' * 60}\n")


def delete_records(db, record_ids: List[int]) -> int:
    """Delete TextRecord rows by id; cascade handles BRRecordStage.

    Args:
        db: SQLAlchemy session.
        record_ids: TextRecord ids to delete.

    Returns:
        Number of rows deleted.
    """
    if not record_ids:
        return 0

    deleted = (
        db.query(TextRecord)
        .filter(TextRecord.id.in_(record_ids))
        .delete(synchronize_session=False)
    )
    db.commit()
    return deleted


def main() -> None:
    """Entry point — dry-run by default, commits only with --execute."""
    args = parse_args()
    db = SessionLocal()

    try:
        print("Scanning all datasets for empty-text records…")
        record_ids = find_empty_record_ids(db)
        build_preview(db, record_ids)

        if not record_ids:
            return

        if not args.execute:
            print("DRY-RUN — no changes made.")
            print("Re-run with --execute to commit deletions.\n")
            return

        # Safety confirmation
        confirm = input(
            f"About to DELETE {len(record_ids)} TextRecord rows (+ cascaded BRRecordStage rows).\n"
            "Type 'yes' to proceed: "
        ).strip().lower()
        if confirm != "yes":
            print("Aborted.")
            return

        deleted = delete_records(db, record_ids)
        print(f"Deleted {deleted} TextRecord rows (BRRecordStage rows removed via cascade).")

    except Exception as e:
        db.rollback()
        print(f"Error: {e}", file=sys.stderr)
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
