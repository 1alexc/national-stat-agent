"""The App wrapper and the opt-in analytics plugin (Lab 4).

A plugin that is silently not loaded raises nothing and logs nothing, so the two
failure modes worth pinning are: it is on when it should be off, and the AG-UI adapter
is built in a way that drops it.
"""

import inspect

from backend.social_poster import agent as agent_module


def test_app_wraps_the_root_agent_with_no_plugins_by_default(monkeypatch):
    monkeypatch.setattr(agent_module, "_BQ_DATASET", "")

    assert agent_module.app.name == "social_poster"
    assert agent_module.app.root_agent is agent_module.root_agent
    assert agent_module._analytics_plugins() == []


def test_analytics_plugin_is_built_when_a_dataset_is_set(monkeypatch):
    import google.adk.plugins.bigquery_agent_analytics_plugin as bq

    seen = {}

    class FakePlugin:
        def __init__(self, **kwargs):
            seen.update(kwargs)

    monkeypatch.setattr(bq, "BigQueryAgentAnalyticsPlugin", FakePlugin)
    monkeypatch.setattr(agent_module, "_BQ_DATASET", "agent_analytics")
    monkeypatch.setenv("PROJECT_ID", "my-project-id")
    monkeypatch.setenv("GOOGLE_CLOUD_PROJECT", "123456789")  # Agent Runtime sets the NUMBER

    plugins = agent_module._analytics_plugins()

    assert len(plugins) == 1
    assert seen["project_id"] == "my-project-id"  # the id, not the number
    assert seen["dataset_id"] == "agent_analytics"
    assert seen["table_id"] == "agent_events"


def test_main_builds_the_adapter_from_the_app():
    """ADKAgent(adk_agent=...) cannot carry plugins; only from_app can."""
    from pathlib import Path

    source = (Path(inspect.getsourcefile(agent_module)).parents[1] / "main.py").read_text()

    assert "ADKAgent.from_app(" in source
    assert "ADKAgent(\n    adk_agent=" not in source


def test_ons_mcp_server_wired_into_research_agent():
    """research_agent uses the UK ONS MCP toolset, and ONS_MCP_SERVER exists on disk."""
    assert agent_module.ONS_MCP_SERVER.exists()
    assert agent_module.ons_toolset in agent_module.research_agent.tools
    assert set(agent_module.ONS_TOOLS) == {
        "list_datasets",
        "search_datasets",
        "get_dataset",
        "get_dataset_dimensions",
        "get_dimension_options",
        "get_observation",
        "get_latest_data",
    }
    # google_search must stay isolated in web_research_agent, not mixed into research_agent
    assert agent_module.google_search not in agent_module.research_agent.tools
    assert agent_module.google_search in agent_module.web_research_agent.tools


def test_posting_toolsets_do_not_collide_on_create_post():
    """When both linkedin_post_toolset and buffer_post_toolset are enabled,
    Buffer's toolset prefixes tool names with 'buffer' so Gemini never rejects
    the request with 'Duplicate function declaration found: create_post'."""
    assert agent_module.linkedin_post_toolset.tool_name_prefix is None
    if agent_module.buffer_post_toolset is not None:
        assert agent_module.buffer_post_toolset.tool_name_prefix == "buffer"


def test_data_source_provenance_tracking_and_combined_research():
    """Verify ONS MCP tool calls, web search, and combined research update
    state['data_source'], state['data_source_label'], and preserve combined notes."""

    class DummyTool:
        def __init__(self, name: str):
            self.name = name

    class DummyContext:
        def __init__(self):
            self.state = {}

    ctx = DummyContext()

    # 1. ONS MCP tool call inside research_agent
    agent_module._track_stage_before_tool(DummyTool("research_agent"), {}, ctx)
    assert ctx.state["pipeline_stage"] == "researching"
    agent_module._track_ons_tool(
        DummyTool("get_latest_data"),
        {"dataset_id": "cpih01"},
        ctx,
        {"status": "ok"},
    )
    ctx.state["research_notes"] = "CPIH rose by 3.0%"
    agent_module._track_stage(DummyTool("research_agent"), {}, ctx, {})

    assert ctx.state["data_source"] == "ons_mcp"
    assert "cpih01" in ctx.state["ons_datasets_used"]
    assert "get_latest_data" in ctx.state["ons_tools_used"]
    assert "Verified UK ONS MCP Server" in ctx.state["data_source_label"]

    # 2. Web research in the SAME turn combines into "both" without wiping ONS notes
    agent_module._track_stage_before_tool(DummyTool("web_research_agent"), {}, ctx)
    ctx.state["research_notes"] = "Bank of England commentary on inflation."
    agent_module._track_stage(DummyTool("web_research_agent"), {}, ctx, {})

    assert ctx.state["data_source"] == "both"
    assert "Combined" in ctx.state["data_source_label"]
    assert "CPIH rose by 3.0%" in ctx.state["research_notes"]
    assert "Bank of England commentary" in ctx.state["research_notes"]


def test_track_image_state_populates_generated_images():
    """_track_image_state records generated images in state['generated_images'] for PostGallery."""

    class DummyTool:
        def __init__(self, name: str):
            self.name = name

    class DummyContext:
        def __init__(self):
            self.state = {}

    ctx = DummyContext()
    agent_module._track_image_state(
        DummyTool("generate_image"),
        {"prompt": "UK CPIH chart"},
        ctx,
        {"status": "success", "image_path": "/tmp/gallery/post-123-abc.png"},
    )

    assert len(ctx.state["generated_images"]) == 1
    assert ctx.state["generated_images"][0]["url"].endswith("/outputs/post-123-abc.png")
    assert ctx.state["generated_images"][0]["imagePath"] == "/tmp/gallery/post-123-abc.png"
    assert ctx.state["current_image_prompt"] == "UK CPIH chart"


def test_new_research_topic_resets_previous_post_image_state():
    """Starting a new research topic in the same chat session must clear
    current_image_path / current_image_display_url / current_image_url so the
    second post generates its own graph instead of reusing the first post's graph."""

    class DummyTool:
        def __init__(self, name: str):
            self.name = name

    class DummyContext:
        def __init__(self):
            self.state = {}

    ctx = DummyContext()

    # Turn 1: Research topic 1 (birth/death rates) + generate image 1 + await approval
    agent_module._track_stage_before_tool(DummyTool("research_agent"), {}, ctx)
    ctx.state["research_notes"] = "Births and deaths 1999-2023"
    agent_module._track_stage(DummyTool("research_agent"), {}, ctx, {})

    agent_module._track_stage_before_tool(DummyTool("draft_agent"), {}, ctx)
    agent_module._track_image_state(
        DummyTool("generate_image"),
        {"prompt": "UK birth and death rates 1999-2023"},
        ctx,
        {"status": "success", "image_path": "/tmp/gallery/post-image-111-birth.png"},
    )
    ctx.state["current_draft"] = "UK natural population growth is near zero."
    agent_module._track_stage(DummyTool("draft_agent"), {}, ctx, {})
    ctx.state["pipeline_stage"] = "posted"

    assert ctx.state["current_image_path"] == "/tmp/gallery/post-image-111-birth.png"
    assert ctx.state["current_image_display_url"].endswith("/outputs/post-image-111-birth.png")

    # Turn 2: User asks about a second subject (credit card spending)
    agent_module._init_stage(ctx)
    agent_module._track_stage_before_tool(DummyTool("research_agent"), {}, ctx)

    assert ctx.state["current_image_path"] is None
    assert ctx.state["current_image_display_url"] is None
    assert ctx.state["current_image_url"] is None
    assert ctx.state["current_image_prompt"] is None
    assert ctx.state["current_draft"] is None
    # Historical generated_images list is preserved for already-approved posts in PostGallery
    assert len(ctx.state["generated_images"]) == 1

