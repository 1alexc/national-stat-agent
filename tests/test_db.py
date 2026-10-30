"""Unit tests for backend/social_poster/db.py.

Runs against a throwaway sqlite file per test (monkeypatched DB_PATH), never
the real social_spark.db at the repo root.
"""

from backend.social_poster import db


def test_save_post_returns_the_saved_row(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "posts.db")
    db.init_db()

    saved = db.save_post(
        platform="linkedin",
        text="hello world",
        post_url="https://example.com/post/1",
        image_path="/tmp/img.png",
        image_url="https://example.com/img.png",
    )

    assert saved["id"] is not None
    assert saved["platform"] == "linkedin"
    assert saved["text"] == "hello world"
    assert saved["post_url"] == "https://example.com/post/1"
    assert saved["image_path"] == "/tmp/img.png"
    assert saved["image_url"] == "https://example.com/img.png"
    assert saved["created_at"]  # non-empty ISO timestamp


def test_save_post_defaults_image_fields_to_none(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "posts.db")
    db.init_db()

    saved = db.save_post(platform="x", text="no image here", post_url=None)

    assert saved["image_path"] is None
    assert saved["image_url"] is None
    assert saved["post_url"] is None


def test_list_posts_returns_newest_first(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "posts.db")
    db.init_db()

    for i in range(3):
        db.save_post(platform="linkedin", text=f"post {i}", post_url=None)

    posts = db.list_posts()

    assert [p["text"] for p in posts] == ["post 2", "post 1", "post 0"]


def test_list_posts_respects_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "posts.db")
    db.init_db()

    for i in range(5):
        db.save_post(platform="linkedin", text=f"post {i}", post_url=None)

    posts = db.list_posts(limit=2)

    assert len(posts) == 2


def test_list_posts_empty_db_returns_empty_list(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "posts.db")
    db.init_db()

    assert db.list_posts() == []


def test_init_db_is_idempotent(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "posts.db")
    db.init_db()
    db.save_post(platform="linkedin", text="survives a second init_db", post_url=None)

    db.init_db()  # CREATE TABLE IF NOT EXISTS — must not wipe existing rows

    assert len(db.list_posts()) == 1


def test_save_post_persists_data_source_provenance(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "posts.db")
    db.init_db()

    saved = db.save_post(
        platform="buffer",
        text="ONS CPIH annual inflation held steady.",
        post_url=None,
        data_source="both",
        data_source_label="Combined: UK ONS MCP Server + General Web Search",
    )

    assert saved["data_source"] == "both"
    assert saved["data_source_label"] == "Combined: UK ONS MCP Server + General Web Search"

    posts = db.list_posts()
    assert len(posts) == 1
    assert posts[0]["data_source"] == "both"
    assert posts[0]["data_source_label"] == "Combined: UK ONS MCP Server + General Web Search"


def test_list_posts_normalizes_legacy_records_without_data_source(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "posts.db")
    db.init_db()

    # Emulate legacy record with null data_source
    saved = db.save_post(
        platform="x",
        text="Official UK ONS data shows CPIH rate change.",
        post_url=None,
        data_source=None,
        data_source_label=None,
    )
    assert saved["data_source"] is None

    posts = db.list_posts()
    assert len(posts) == 1
    assert posts[0]["data_source"] == "ons_mcp"


def test_save_and_list_posts_deduplicates_same_text_across_platforms(tmp_path, monkeypatch):
    """If the same post text is saved via dry-run X and then Buffer, only a
    single post record is retained and returned, preferring Buffer and preserving
    the statistical graph and data_source."""
    monkeypatch.setattr(db, "DB_PATH", tmp_path / "posts.db")
    monkeypatch.setattr(db, "use_gcs", False)
    db.init_db()

    post_text = "The Great Divide: whilst ONS figures show UK unemployment shot from 1.29m to 1.64m since 2022..."
    db.save_post(
        platform="X",
        text=post_text,
        post_url="https://x.com/i/web/status/dryrun-123456",
        image_path="/tmp/gallery/post-image-999.png",
        image_url=None,
        data_source="both",
        data_source_label="Combined: UK ONS MCP Server + General Web Search",
    )
    db.save_post(
        platform="Buffer",
        text=post_text,
        post_url=None,
        image_path="/tmp/gallery/post-image-999.png",
        image_url="https://storage.googleapis.com/national-stat-ag-images/post-image-999.png",
        data_source="both",
        data_source_label="Combined: UK ONS MCP Server + General Web Search",
    )

    posts = db.list_posts()
    assert len(posts) == 1
    assert posts[0]["platform"] == "Buffer"
    assert posts[0]["text"] == post_text
    assert posts[0]["post_url"] is None  # dryrun URL stripped when upgraded to Buffer
    assert posts[0]["image_path"] == "/tmp/gallery/post-image-999.png"
    assert posts[0]["image_url"] == "https://storage.googleapis.com/national-stat-ag-images/post-image-999.png"
    assert posts[0]["data_source"] == "both"


