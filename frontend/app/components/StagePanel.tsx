"use client";

import { useCoAgent, useCopilotChatInternal } from "@copilotkit/react-core";

export type AgentState = {
  pipeline_stage?: string;
  memory_enabled?: boolean;
  used_ons_mcp?: boolean;
  used_web_search?: boolean;
  ons_tools_used?: string[];
  ons_datasets_used?: string[];
  data_source?: "ons_mcp" | "web_search" | "both" | null;
  data_source_label?: string | null;
  current_image_path?: string | null;
  current_image_display_url?: string | null;
  current_image_url?: string | null;
  generated_images?: {
    id: string;
    url: string;
    prompt?: string;
    imagePath?: string;
    hostedUrl?: string;
    hostedDryRun?: boolean;
  }[];
};

type MessageAnalysis = {
  inFlightStage?: string;
  inFlightTool?: string;
  usedMemory: boolean;
  usedOns: boolean;
  usedWeb: boolean;
};

/**
 * Inspect the live AG-UI message stream so:
 * 1. In-flight tool calls (e.g. research_agent, draft_agent) immediately advance
 *    the pipeline stepper before AgentTool finishes and emits its final state_delta.
 * 2. Even if backend state_delta hasn't populated data_source (e.g. from an earlier
 *    turn before reload), we can still deterministically tell whether research_agent
 *    (ONS MCP server), web_research_agent (Google Search), or both were called.
 */
function analyzeMessages(messages: any[]): MessageAnalysis {
  const completedIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === "tool" && msg.toolCallId) {
      completedIds.add(msg.toolCallId);
    }
  }

  let inFlightStage: string | undefined;
  let inFlightTool: string | undefined;
  let usedMemory = false;
  let usedOns = false;
  let usedWeb = false;

  for (const msg of messages) {
    if (msg.role === "user") {
      // Track provenance per user research cycle if a new research call happens later,
      // but keep previous cycle's provenance if the new user message is just "approve".
      continue;
    }
    if (msg.role === "assistant" && Array.isArray(msg.toolCalls)) {
      // If this assistant turn starts fresh research, reset message-derived flags
      // unless both are called in the same turn.
      const namesInMsg = msg.toolCalls.map((c: any) => c.function?.name);
      if (
        (namesInMsg.includes("research_agent") || namesInMsg.includes("web_research_agent")) &&
        !inFlightTool
      ) {
        // Keep accumulating within the latest research turn
      }
      for (const call of msg.toolCalls) {
        const name = call.function?.name;
        if (name === "memory_agent" || name === "load_memory") {
          usedMemory = true;
        } else if (name === "research_agent" || (name && ONS_TOOL_NAMES.has(name))) {
          usedOns = true;
        } else if (name === "web_research_agent") {
          usedWeb = true;
        }

        if (!completedIds.has(call.id)) {
          inFlightTool = name;
          if (name === "memory_agent" || name === "load_memory") {
            inFlightStage = "consulting_memory";
          } else if (name === "research_agent" || name === "web_research_agent") {
            inFlightStage = "researching";
          } else if (name === "draft_agent") {
            inFlightStage = "drafting";
          }
        }
      }
    }
  }

  return { inFlightStage, inFlightTool, usedMemory, usedOns, usedWeb };
}

const ONS_TOOL_NAMES = new Set([
  "list_datasets",
  "search_datasets",
  "get_dataset",
  "get_dataset_dimensions",
  "get_dimension_options",
  "get_observation",
  "get_latest_data",
]);

/** Horizontal stepper mirroring the backend's pipeline_stage shared state + live tool stream. */
export function StagePanel() {
  const { state } = useCoAgent<AgentState>({ name: "social_poster" });
  const { messages } = useCopilotChatInternal();
  const analysis = analyzeMessages((messages as any[]) ?? []);

  const showMemoryStep = Boolean(state?.memory_enabled || analysis.usedMemory);

  const effectiveSource: "ons_mcp" | "web_search" | "both" | null =
    state?.data_source ??
    (analysis.usedOns && analysis.usedWeb
      ? "both"
      : analysis.usedOns
        ? "ons_mcp"
        : analysis.usedWeb
          ? "web_search"
          : null);

  const researchLabel =
    effectiveSource === "both"
      ? "ONS API + Web"
      : effectiveSource === "web_search" || analysis.inFlightTool === "web_research_agent"
        ? "Web Search"
        : "Querying ONS API";

  const stages: { key: string; icon: string; label: string }[] = [
    { key: "idea", icon: "💡", label: "Question / Idea" },
    ...(showMemoryStep
      ? [{ key: "consulting_memory", icon: "🧠", label: "Consulting memory" }]
      : []),
    {
      key: "researching",
      icon: effectiveSource === "web_search" ? "🌐" : "📊",
      label: researchLabel,
    },
    { key: "drafting", icon: "✍️", label: "Drafting & Graphing" },
    { key: "awaiting_approval", icon: "⏳", label: "Approval" },
    { key: "posted", icon: "🚀", label: "Posted" },
  ];

  // Live in-flight tool call takes priority over lagging state_delta while a sub-agent runs.
  let current = analysis.inFlightStage ?? state?.pipeline_stage ?? "idea";
  if (current === "consulting_memory" && !showMemoryStep) {
    current = "researching";
  }
  const currentIdx = stages.findIndex((s) => s.key === current);

  const datasets = state?.ons_datasets_used ?? [];
  const onsTools = state?.ons_tools_used ?? [];

  return (
    <section className="card">
      <h2>Pipeline</h2>
      <ol className="stepper">
        {stages.map((stage, i) => {
          const status =
            i < currentIdx ? "done" : i === currentIdx ? "current" : "";
          return (
            <li key={stage.key} className={`step ${status}`}>
              <div className="dot">{i < currentIdx ? "✓" : stage.icon}</div>
              {stage.label}
            </li>
          );
        })}
      </ol>

      {(effectiveSource || analysis.inFlightStage === "researching") && (
        <div
          className={`source-banner ${
            effectiveSource === "ons_mcp"
              ? "source-ons"
              : effectiveSource === "both"
                ? "source-both"
                : "source-web"
          }`}
        >
          <div className="source-header">
            <span className="source-badge">
              {effectiveSource === "ons_mcp" && "🏛️ Verified UK ONS MCP Server"}
              {effectiveSource === "web_search" && "🌐 General Web Search (Google Search)"}
              {effectiveSource === "both" &&
                "🔗 Combined: UK ONS MCP Server + General Web Search"}
              {!effectiveSource &&
                analysis.inFlightTool === "research_agent" &&
                "⏳ Querying UK ONS MCP Server…"}
              {!effectiveSource &&
                analysis.inFlightTool === "web_research_agent" &&
                "⏳ Searching the web…"}
            </span>
            <span className="source-subtext">
              {effectiveSource === "ons_mcp" &&
                "Data retrieved directly from official Office for National Statistics API via MCP"}
              {effectiveSource === "web_search" &&
                "Retrieved via Google Search (no ONS MCP dataset queried)"}
              {effectiveSource === "both" &&
                "Combines official UK ONS MCP dataset observations with Google Web Search context"}
            </span>
          </div>

          {(datasets.length > 0 || onsTools.length > 0) && (
            <div className="source-meta">
              {datasets.length > 0 && (
                <span className="source-pill">
                  <strong>ONS Datasets:</strong> {datasets.join(", ")}
                </span>
              )}
              {onsTools.length > 0 && (
                <span className="source-pill">
                  <strong>MCP Tools:</strong> {onsTools.join(", ")}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
