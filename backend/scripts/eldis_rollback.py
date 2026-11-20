"""Preview or explicitly undo an Eldis import batch without overwriting later edits."""

import argparse
import asyncio
from uuid import UUID

import asyncpg

from .eldis_import import connection


async def rollback_batch(conn, batch_id, *, apply=False):
    async with conn.transaction(readonly=not apply):
        if apply:
            await conn.execute("SET LOCAL lock_timeout = '5s'")
            await conn.execute("LOCK TABLE public.asset_locations IN SHARE ROW EXCLUSIVE MODE")
        counts = await conn.fetchrow("""
            SELECT count(*) AS total,
                   count(*) FILTER (WHERE loc.eldis_url = change.imported_url
                                    AND loc.eldis_url_revision = change.imported_revision) AS restorable
            FROM public.eldis_link_import_changes AS change
            LEFT JOIN public.asset_locations AS loc ON loc.id = change.location_id
            WHERE change.batch_id = $1
        """, batch_id)
        if not counts["total"]:
            raise ValueError("No imported rows found for this batch")
        if apply:
            restored = await conn.fetch("""
                UPDATE public.asset_locations AS loc
                SET eldis_url = change.previous_url
                FROM public.eldis_link_import_changes AS change
                WHERE change.batch_id = $1 AND loc.id = change.location_id
                  AND loc.eldis_url = change.imported_url
                  AND loc.eldis_url_revision = change.imported_revision
                RETURNING loc.id
            """, batch_id)
            if len(restored) != counts["restorable"]:
                raise RuntimeError("Rollback changed unexpectedly. No changes were committed")
    return counts["restorable"], counts["total"] - counts["restorable"]


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--batch", type=UUID, required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    conn = await connection()
    try:
        candidates, skipped = await rollback_batch(conn, args.batch, apply=args.apply)
    finally:
        await conn.close()
    if args.apply:
        print(f"batch={args.batch} restored={candidates} skipped={skipped}")
    else:
        print(f"dry-run batch={args.batch} restorable={candidates} skipped={skipped}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (ValueError, OSError, asyncpg.PostgresError) as error:
        raise SystemExit(f"Rollback stopped: {error}") from None
