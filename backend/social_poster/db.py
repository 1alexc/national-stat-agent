"""Durable store for published posts.

Session state (agent.py's current_image_path/current_image_url) only lives
as long as the ADK session does, and PostGallery.tsx had to reconstruct
post<->image links by fuzzy-matching the live chat message stream. This gives
published posts a durable record instead, keyed by their own id, so the
frontend can just read it back rather than re-derive it.

Two backends, chosen automatically:

  local      SQLite at <repo>/social_spark.db — stdlib only, no server.
  deployed   One JSON object per post in GCS, under POSTS_PREFIX.

The deployed case exists because a container filesystem is ephemeral: on Agent
Runtime with min_instances=0, a SQLite file is destroyed on every scale-to-zero,
not just on redeploy. Set GCS_BUCKET_NAME to switch.

Why an object per post rather than one JSON array: appending to a shared array
is a read-modify-write, which races as soon as two writes overlap. One
immutable object per post has no such window, and "list the prefix" is a
perfectly good read for a gallery of this size. It is not a general-purpose
database — there are no queries or indexes, and listing is linear — so
anything needing real querying should use Firestore instead.
"""

import datetime
import json
import logging
import os
import pathlib
import sqlite3
import uuid
from typing import Optional

log = logging.getLogger(__name__)

DB_PATH = pathlib.Path(__file__).resolve().parents[2] / "social_spark.db"

_BUCKET = os.environ.get("GCS_BUCKET_NAME", "").strip()
POSTS_PREFIX = os.environ.get("GCS_POSTS_PREFIX", "posts/").strip()
use_gcs = bool(_BUCKET)


# --- GCS backend --------------------------------------------------------------
def _gcs_bucket():
    from google.cloud import storage  # imported lazily: local dev needn't have it

    return storage.Client().bucket(_BUCKET)


def _gcs_save(record: dict) -> dict:
    # Sorting by name has to equal sorting by time, so the id leads with a
    # zero-padded, fixed-width UTC timestamp; the uuid suffix only breaks ties.
    blob = _gcs_bucket().blob(f"{POSTS_PREFIX}{record['id']}.json")
    blob.upload_from_string(json.dumps(record), content_type="application/json")
    return record


def _gcs_list(limit: int) -> list[dict]:
    client_bucket = _gcs_bucket()
    blobs = sorted(
        client_bucket.list_blobs(prefix=POSTS_PREFIX),
        key=lambda b: b.name,
        reverse=True,
    )[:limit]
    posts = []
    for blob in blobs:
        try:
            posts.append(json.loads(blob.download_as_bytes()))
        except (ValueError, UnicodeDecodeError):
            log.warning("Skipping unreadable post object %s", blob.name)
    return posts


# --- SQLite backend -----------------------------------------------------------
def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init_db() -> None:
    if use_gcs:
        return  # nothing to create; a prefix springs into being on first write
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                text TEXT NOT NULL,
                image_path TEXT,
                image_url TEXT,
                post_url TEXT,
                created_at TEXT NOT NULL,
                data_source TEXT,
                data_source_label TEXT
            )
            """
        )
        # Migrate existing tables if data_source columns are missing
        existing_cols = {
            row["name"] for row in conn.execute("PRAGMA table_info(posts)").fetchall()
        }
        if "data_source" not in existing_cols:
            conn.execute("ALTER TABLE posts ADD COLUMN data_source TEXT")
        if "data_source_label" not in existing_cols:
            conn.execute("ALTER TABLE posts ADD COLUMN data_source_label TEXT")


# --- Public API ---------------------------------------------------------------
def save_post(
    platform: str,
    text: str,
    post_url: Optional[str],
    image_path: Optional[str] = None,
    image_url: Optional[str] = None,
    data_source: Optional[str] = None,
    data_source_label: Optional[str] = None,
) -> dict:
    """Records a successfully published post. Returns the saved record."""
    now = datetime.datetime.now(datetime.timezone.utc)
    created_at = now.isoformat()

    if use_gcs:
        record = {
            "id": f"{now.strftime('%Y%m%dT%H%M%S%f')}-{uuid.uuid4().hex[:8]}",
            "platform": platform,
            "text": text,
            "image_path": image_path,
            "image_url": image_url,
            "post_url": post_url,
            "created_at": created_at,
            "data_source": data_source,
            "data_source_label": data_source_label,
        }
        return _gcs_save(record)

    with _connect() as conn:
        existing = conn.execute(
            "SELECT * FROM posts WHERE TRIM(text) = TRIM(?) ORDER BY id DESC LIMIT 1",
            (text,),
        ).fetchone()
        if existing is not None:
            merged_platform = (
                platform
                if platform.lower().startswith("buffer")
                or not str(existing["platform"] or "").lower().startswith("buffer")
                else existing["platform"]
            )
            merged_post_url = post_url or existing["post_url"]
            if str(merged_platform).lower().startswith("buffer") and merged_post_url and "dryrun-" in str(merged_post_url):
                merged_post_url = post_url
            merged_image_path = image_path or existing["image_path"]
            merged_image_url = image_url or existing["image_url"]
            merged_data_source = data_source or existing["data_source"]
            merged_data_source_label = data_source_label or existing["data_source_label"]
            conn.execute(
                """
                UPDATE posts
                SET platform = ?, post_url = ?, image_path = ?, image_url = ?,
                    created_at = ?, data_source = ?, data_source_label = ?
                WHERE id = ?
                """,
                (
                    merged_platform,
                    merged_post_url,
                    merged_image_path,
                    merged_image_url,
                    created_at,
                    merged_data_source,
                    merged_data_source_label,
                    existing["id"],
                ),
            )
            return {
                "id": existing["id"],
                "platform": merged_platform,
                "text": text,
                "image_path": merged_image_path,
                "image_url": merged_image_url,
                "post_url": merged_post_url,
                "created_at": created_at,
                "data_source": merged_data_source,
                "data_source_label": merged_data_source_label,
            }

        cursor = conn.execute(
            """
            INSERT INTO posts (platform, text, image_path, image_url, post_url, created_at, data_source, data_source_label)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (platform, text, image_path, image_url, post_url, created_at, data_source, data_source_label),
        )
        return {
            "id": cursor.lastrowid,
            "platform": platform,
            "text": text,
            "image_path": image_path,
            "image_url": image_url,
            "post_url": post_url,
            "created_at": created_at,
            "data_source": data_source,
            "data_source_label": data_source_label,
        }


def _deduplicate_posts(posts: list[dict]) -> list[dict]:
    """Collapse duplicate records with identical post text (keeping newest-first
    order and merging any non-null image/url/provenance fields, preferring Buffer
    over a local dry-run platform label when both exist for the same post)."""
    deduped: list[dict] = []
    seen_by_text: dict[str, dict] = {}
    for raw in posts:
        post = dict(raw)
        key = (post.get("text") or "").strip()
        if not key:
            deduped.append(post)
            continue
        existing = seen_by_text.get(key)
        if existing is None:
            seen_by_text[key] = post
            deduped.append(post)
        else:
            for field in (
                "image_path",
                "image_url",
                "post_url",
                "data_source",
                "data_source_label",
            ):
                if not existing.get(field) and post.get(field):
                    existing[field] = post[field]
            if (
                str(post.get("platform", "")).lower().startswith("buffer")
                and not str(existing.get("platform", "")).lower().startswith("buffer")
            ):
                existing["platform"] = post["platform"]
            if (
                str(existing.get("platform", "")).lower().startswith("buffer")
                and existing.get("post_url")
                and "dryrun-" in str(existing.get("post_url"))
            ):
                existing["post_url"] = None
    return deduped


def _normalize_post_provenance(post: dict) -> dict:
    """Ensures data_source is populated, inferring from content for legacy rows."""
    if not post.get("data_source"):
        text = (post.get("text") or "").lower()
        has_ons = (
            "ons" in text
            or "office for national statistics" in text
            or "cpih" in text
            or "census" in text
            or "inflation" in text
            or "gdp" in text
            or "wellbeing" in text
            or bool(post.get("image_path") or post.get("image_url"))
        )
        has_web = "web" in text or "search" in text or "google" in text
        if has_ons and has_web:
            post["data_source"] = "both"
            if not post.get("data_source_label"):
                post["data_source_label"] = "Combined: UK ONS MCP Server + General Web Search"
        elif has_ons:
            post["data_source"] = "ons_mcp"
            if not post.get("data_source_label"):
                post["data_source_label"] = "Verified UK ONS MCP Server"
        elif has_web:
            post["data_source"] = "web_search"
            if not post.get("data_source_label"):
                post["data_source_label"] = "General Web Search (Google Search)"
        else:
            post["data_source"] = "ons_mcp"
            if not post.get("data_source_label"):
                post["data_source_label"] = "Verified UK ONS MCP Server"
    return post


def list_posts(limit: int = 50) -> list[dict]:
    if use_gcs:
        posts = _gcs_list(max(limit * 2, limit))
    else:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT * FROM posts ORDER BY id DESC LIMIT ?", (max(limit * 2, limit),)
            ).fetchall()
            posts = [dict(row) for row in rows]
    deduped = _deduplicate_posts(posts)[:limit]
    return [_normalize_post_provenance(p) for p in deduped]


init_db()  # table must exist before any save_post/list_posts call
