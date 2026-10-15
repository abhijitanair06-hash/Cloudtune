"""Read-only audit of existing Supabase Storage music files.

Run from the backend directory:
    python Tests/inspect_storage_metadata.py

This script lists bucket objects and reads embedded MP3 tags. It does not
modify Storage or the PostgreSQL database and never prints credentials.
"""

import io
import json
import sys
from typing import Any

from mutagen import File as MutagenFile
from supabase import create_client

from app.core.config import settings


def clean_tag(tags: Any, key: str) -> str | None:
    if not tags:
        return None
    value = tags.get(key)
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        value = value[0] if value else None
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def inspect_mp3(storage: Any, object_name: str) -> dict[str, Any]:
    result: dict[str, Any] = {
        "name": object_name,
        "type": "audio",
        "title": None,
        "artist": None,
        "album": None,
        "genre": None,
        "date": None,
        "duration_seconds": None,
        "bitrate_kbps": None,
        "tag_status": "unknown",
    }

    try:
        audio_bytes = storage.download(object_name)
        audio = MutagenFile(io.BytesIO(audio_bytes), easy=True)
        if audio is None:
            result["tag_status"] = "could_not_read_audio"
            return result

        tags = audio.tags or {}
        for key in ("title", "artist", "album", "genre", "date", "tracknumber"):
            value = clean_tag(tags, key)
            if value:
                result[key] = value

        info = getattr(audio, "info", None)
        if info is not None:
            length = getattr(info, "length", None)
            bitrate = getattr(info, "bitrate", None)
            if length is not None:
                result["duration_seconds"] = round(float(length), 2)
            if bitrate is not None:
                result["bitrate_kbps"] = round(float(bitrate) / 1000, 1)

        result["tag_status"] = (
            "embedded_tags_found"
            if result["title"] or result["artist"]
            else "no_title_or_artist_tags"
        )

    except Exception as exc:
        # Avoid including connection objects or configuration in output.
        result["tag_status"] = "read_failed"
        result["error_type"] = type(exc).__name__

    return result


def main() -> int:
    try:
        client = create_client(
            settings.supabase_url,
            settings.supabase_key,
        )
        storage = client.storage.from_(settings.supabase_bucket)
        objects = storage.list()
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "failed",
                    "error_type": type(exc).__name__,
                    "message": "Could not list the configured Storage bucket. "
                    "Check the backend .env and bucket permissions locally.",
                },
                indent=2,
            )
        )
        return 1

    report: list[dict[str, Any]] = []
    for item in objects:
        name = item.get("name")
        if not name:
            continue

        metadata = item.get("metadata") or {}
        extension = name.lower().rsplit(".", 1)[-1] if "." in name else ""
        record: dict[str, Any] = {
            "name": name,
            "type": (
                "audio" if extension == "mp3"
                else "cover" if extension in {"jpg", "jpeg", "png", "webp"}
                else "other"
            ),
            "created_at": item.get("created_at"),
            "size_bytes": metadata.get("size") or metadata.get("contentLength"),
            "mime_type": metadata.get("mimetype") or metadata.get("contentType"),
        }

        if extension == "mp3":
            record.update(inspect_mp3(storage, name))
            # Keep the object name and storage metadata as the authoritative values.
            record["created_at"] = item.get("created_at")
            record["size_bytes"] = (
                metadata.get("size")
                or metadata.get("contentLength")
                or record.get("size_bytes")
            )
            record["mime_type"] = metadata.get("mimetype") or metadata.get("contentType")

        report.append(record)

    report.sort(key=lambda item: (item.get("created_at") or "", item.get("name") or ""))
    print(json.dumps({"status": "success", "bucket": settings.supabase_bucket, "objects": report}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
