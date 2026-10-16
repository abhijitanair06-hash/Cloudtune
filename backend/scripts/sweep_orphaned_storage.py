"""Safely identify and optionally remove orphaned CloudTune storage objects.

Run from the backend directory. This script is a dry run unless --apply is passed.
It only considers CloudTune UUID-named audio/artwork files older than the selected
grace period; other files in the bucket are ignored.
"""

import argparse
import asyncio
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from supabase import create_client

from app.core.config import settings
from app.db.database import AsyncSessionLocal, engine
from app.models.song import Song


CLOUDTUNE_OBJECT_NAME = re.compile(
    r"^[0-9a-fA-F-]{36}\.(?:mp3|jpg|jpeg|png|webp)$",
    re.IGNORECASE,
)


def parse_timestamp(value):
    if not value:
        return None
    try:
        timestamp = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return timestamp.replace(tzinfo=timezone.utc) if timestamp.tzinfo is None else timestamp
    except (TypeError, ValueError):
        return None


async def referenced_paths():
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Song.file_path, Song.cover_path))
        paths = set()
        for file_path, cover_path in result.all():
            if file_path:
                paths.add(file_path)
            if cover_path:
                paths.add(cover_path)
        return paths


def list_bucket_objects(bucket):
    offset = 0
    while True:
        page = bucket.list("", {"limit": 1000, "offset": offset})
        if not page:
            break
        for item in page:
            yield item
        offset += len(page)
        if len(page) < 1000:
            break


async def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually remove eligible orphan objects. Without this flag, only report them.",
    )
    parser.add_argument(
        "--min-age-hours",
        type=int,
        default=24,
        help="Grace period for orphan objects (default: 24 hours).",
    )
    args = parser.parse_args()
    if args.min_age_hours < 1:
        parser.error("--min-age-hours must be at least 1")

    client = create_client(settings.supabase_url, settings.supabase_key)
    bucket = client.storage.from_(settings.supabase_bucket)
    try:
        referenced = await referenced_paths()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=args.min_age_hours)
        orphan_paths = []
        skipped_unknown_age = 0

        for item in await asyncio.to_thread(lambda: list(list_bucket_objects(bucket))):
            name = item.get("name")
            if not name or name in referenced or not CLOUDTUNE_OBJECT_NAME.fullmatch(name):
                continue

            metadata = item.get("metadata") or {}
            created_at = parse_timestamp(item.get("created_at") or metadata.get("created_at"))
            if created_at is None:
                skipped_unknown_age += 1
                continue
            if created_at < cutoff:
                orphan_paths.append(name)

        print(f"Referenced song/artwork objects: {len(referenced)}")
        print(f"Eligible orphan objects (older than {args.min_age_hours}h): {len(orphan_paths)}")
        print(f"Objects skipped because age could not be verified: {skipped_unknown_age}")
        for path in orphan_paths:
            print(f"{'DELETE' if args.apply else 'DRY-RUN'} {path}")

        if args.apply:
            for offset in range(0, len(orphan_paths), 100):
                batch = orphan_paths[offset : offset + 100]
                await asyncio.to_thread(bucket.remove, batch)
            print(f"Removed {len(orphan_paths)} orphan object(s).")
        else:
            print("No objects were removed. Re-run with --apply after reviewing this list.")
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
