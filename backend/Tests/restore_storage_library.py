"""Safely recreate song database rows for existing Supabase Storage objects.

This never uploads or deletes storage objects. It is idempotent: rows whose
file_path already exists are skipped.

Preview:
    python -m Tests.restore_storage_library --user-id 1

Apply after reviewing the preview:
    python -m Tests.restore_storage_library --user-id 1 --apply
"""

import argparse
import asyncio
import io
import json
from datetime import datetime
from typing import Any

from mutagen import File as MutagenFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.database import AsyncSessionLocal
from app.models.song import Song
from app.models.user import User
from supabase import create_client


def parse_time(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def get_tag(tags: Any, name: str) -> str | None:
    if not tags:
        return None
    value = tags.get(name)
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    if value is None:
        return None
    result = str(value).strip()
    return result or None


def inspect_audio(storage: Any, filename: str) -> dict[str, Any]:
    record: dict[str, Any] = {
        "title": None,
        "artist": None,
        "album": None,
        "genre": None,
        "duration_seconds": None,
    }
    try:
        file_bytes = storage.download(filename)
        audio = MutagenFile(io.BytesIO(file_bytes), easy=True)
        if audio is None:
            return record
        tags = audio.tags or {}
        for name in ("title", "artist", "album", "genre"):
            record[name] = get_tag(tags, name)
        length = getattr(getattr(audio, "info", None), "length", None)
        if length is not None:
            record["duration_seconds"] = round(float(length), 2)
    except Exception as exc:
        print(f"Warning: metadata could not be read for {filename} ({type(exc).__name__}).")
    return record


def choose_cover(
    audio_object: dict[str, Any],
    cover_objects: list[dict[str, Any]],
    used_covers: set[str],
) -> str | None:
    audio_time = parse_time(audio_object.get("created_at"))
    if audio_time is None:
        return None

    options: list[tuple[float, str]] = []
    for cover in cover_objects:
        name = cover.get("name")
        if not name or name in used_covers:
            continue
        cover_time = parse_time(cover.get("created_at"))
        if cover_time is None:
            continue
        delta = abs((cover_time - audio_time).total_seconds())
        # The observed cover uploads followed their corresponding MP3s by < 1 second.
        if delta <= 30:
            options.append((delta, name))

    if not options:
        return None

    options.sort(key=lambda item: item[0])
    selected = options[0][1]
    used_covers.add(selected)
    return selected


async def preview_or_restore(user_id: int, apply: bool) -> int:
    async with AsyncSessionLocal() as db:
        user = await db.get(User, user_id)
        if user is None:
            print(f"No user with ID {user_id} exists in the configured database.")
            users = (await db.execute(select(User).order_by(User.id))).scalars().all()
            if users:
                print("Available users:")
                for item in users:
                    print(f"  id={item.id} username={item.username}")
            return 1

        client = create_client(settings.supabase_url, settings.supabase_key)
        storage = client.storage.from_(settings.supabase_bucket)
        objects = storage.list()

        audios = [
            item for item in objects
            if str(item.get("name", "")).lower().endswith(".mp3")
        ]
        covers = [
            item for item in objects
            if str(item.get("name", "")).lower().endswith(
                (".jpg", ".jpeg", ".png", ".webp")
            )
        ]
        audios.sort(key=lambda item: (item.get("created_at") or "", item.get("name") or ""))

        if not audios:
            print(f"No MP3 files found in bucket '{settings.supabase_bucket}'.")
            return 1

        filenames = [item["name"] for item in audios]
        existing_result = await db.execute(
            select(Song.file_path).where(Song.file_path.in_(filenames))
        )
        existing_paths = set(existing_result.scalars().all())

        used_covers: set[str] = set()
        candidates: list[dict[str, Any]] = []

        for index, audio_object in enumerate(audios, start=1):
            filename = audio_object["name"]
            if filename in existing_paths:
                candidates.append({
                    "status": "already_registered",
                    "file_path": filename,
                })
                continue

            metadata = inspect_audio(storage, filename)
            title = metadata["title"] or f"Recovered Track {index:02d}"
            artist = metadata["artist"] or "Unknown Artist"
            cover_path = choose_cover(audio_object, covers, used_covers)
            candidates.append({
                "status": "would_add" if apply else "preview",
                "title": title,
                "artist": artist,
                "album": metadata["album"],
                "genre": metadata["genre"],
                "duration_seconds": metadata["duration_seconds"],
                "file_path": filename,
                "cover_path": cover_path,
                "uploaded_by": user.id,
            })

        print(json.dumps({
            "mode": "APPLY" if apply else "PREVIEW ONLY",
            "user_id": user.id,
            "username": user.username,
            "bucket": settings.supabase_bucket,
            "audio_files_found": len(audios),
            "cover_files_found": len(covers),
            "records": candidates,
            "note": (
                "No storage objects are modified. Preview mode makes no database changes."
                if not apply
                else "Only missing song rows were inserted; no storage objects were modified."
            ),
        }, indent=2))

        if not apply:
            print("\nPreview only. Review the proposed rows, then rerun with --apply to save them.")
            return 0

        added = 0
        for item in candidates:
            if item.get("status") != "would_add":
                continue
            song = Song(
                title=item["title"],
                artist=item["artist"],
                album=item["album"],
                genre=item["genre"],
                file_path=item["file_path"],
                cover_path=item["cover_path"],
                uploaded_by=user.id,
            )
            db.add(song)
            added += 1

        if added:
            await db.commit()
        print(f"\nRestore complete. Added {added} song records for user ID {user.id}.")
        print("No MP3 or cover files were uploaded, changed, or deleted.")
        return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", type=int, required=True, help="Existing CloudTune user ID")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually insert missing song records. Without this flag, only preview.",
    )
    args = parser.parse_args()
    return asyncio.run(preview_or_restore(args.user_id, args.apply))


if __name__ == "__main__":
    raise SystemExit(main())
