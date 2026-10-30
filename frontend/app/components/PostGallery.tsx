"use client";

// Approved posts + generated images, pulled from the same AG-UI message
// stream ActivityFeed reads. Images are local files written by
// tools.py:generate_image — backend/main.py mounts them at /outputs so the
// browser can actually render them.
//
// The live message stream only covers THIS browser session — reload the
// page or restart the backend and it's gone. /api/posts (backend/social_poster/db.py)
// is the durable record of what actually got published, so it's merged in
// underneath the live list to fill in anything from before this page load.

import { useEffect, useState } from "react";
import { useCoAgent, useCopilotChatInternal } from "@copilotkit/react-core";
import type { AgentState } from "./StagePanel";

// Same-origin by default: /api/posts and /outputs/* are proxied by this app's
// own route handlers (app/api/posts, app/outputs/[...path]), which add the
// bearer token when the backend is a deployed Agent Runtime engine. The
// browser must not call the backend directly — it has no safe way to hold
// that token. Set NEXT_PUBLIC_BACKEND_ORIGIN only to bypass the proxy and
// point straight at a local backend.
const BACKEND_ORIGIN = process.env.NEXT_PUBLIC_BACKEND_ORIGIN ?? "";

type DataSourceType = "ons_mcp" | "web_search" | "both";

type PostEntry = {
  id: string;
  text: string;
  platform: string;
  url?: string;
  failed: boolean;
  imageUrl?: string;
  dataSource?: DataSourceType;
};

type ImageEntry = {
  id: string;
  url: string;
  prompt: string;
  imagePath: string;
  filename?: string;
  hostedUrl?: string;
  hostedDryRun?: boolean;
};

function tryParseJSON(raw: unknown): any {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// MCP tool results are sometimes wrapped as {content: [{type:"text", text: "<json>"}]}
// (Buffer's remote server) vs. a plain dict (LinkedIn's local FastMCP server).
function unwrapMcpContent(result: any): any {
  if (result && Array.isArray(result.content) && typeof result.content[0]?.text === "string") {
    return tryParseJSON(result.content[0].text);
  }
  return result;
}

// Buffer's create_post takes a channelId; local Social MCP accepts platform ("X" or "LinkedIn").
function inferPlatform(args: any, result?: any): string {
  if (args?.channelId) return "Buffer (X / Social)";
  if (args?.platform) return String(args.platform);
  if (result?.platform) return String(result.platform);
  return "X";
}

// Extract a local gallery filename (e.g. post-image-123-abc.png or chat-upload-123-abc.png) from a path or URL.
function extractOutputFilename(raw: string): string | undefined {
  const m = raw.match(/((?:post-image|post|chat-upload)-[a-z0-9-]+\.(?:png|jpe?g|webp|gif))/i);
  if (m?.[1]) return m[1];
  const anyImg = raw.match(/\/outputs\/([a-z0-9._-]+\.(?:png|jpe?g|webp|gif))/i);
  if (anyImg?.[1]) return anyImg[1];
  return undefined;
}

function toDisplayUrl(rawPathOrUrl: string): string {
  const filename = extractOutputFilename(rawPathOrUrl);
  if (filename) {
    return `${BACKEND_ORIGIN}/outputs/${filename}`;
  }
  return rawPathOrUrl;
}

// Recursively collect every string leaf from a tool call's args — LinkedIn's
// create_post carries the image under a known `image_path` key, but Buffer's
// schema is hosted/dynamic (could nest it under `media`, `attachments`, etc.),
// so this searches every value rather than guessing one key name.
function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === "string") {
    acc.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => collectStrings(v, acc));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((v) => collectStrings(v, acc));
  }
  return acc;
}

function addOrUpdateImage(images: ImageEntry[], candidate: ImageEntry): ImageEntry {
  const filename = candidate.filename ?? extractOutputFilename(candidate.imagePath || candidate.url);
  const normalizedUrl = filename ? `${BACKEND_ORIGIN}/outputs/${filename}` : candidate.url;
  const existing = images.find(
    (img) =>
      (filename && img.filename === filename) ||
      img.url === normalizedUrl ||
      (candidate.imagePath && img.imagePath === candidate.imagePath),
  );
  if (existing) {
    if (candidate.prompt && !existing.prompt) existing.prompt = candidate.prompt;
    if (candidate.hostedUrl) existing.hostedUrl = candidate.hostedUrl;
    if (candidate.hostedDryRun !== undefined) existing.hostedDryRun = candidate.hostedDryRun;
    return existing;
  }
  const entry: ImageEntry = {
    ...candidate,
    url: normalizedUrl,
    filename,
  };
  images.push(entry);
  return entry;
}

// Matches a create_post call back to the image it attached, by looking for
// that image's local path, filename, or hosted URL anywhere in the call's args.
function findImageForPost(args: any, images: ImageEntry[]): ImageEntry | undefined {
  const candidates = collectStrings(args);
  const candidateFilenames = candidates
    .map((c) => extractOutputFilename(c))
    .filter((f): f is string => Boolean(f));

  const matched = images.find(
    (img) =>
      candidates.includes(img.imagePath) ||
      candidates.includes(img.url) ||
      (img.filename && candidateFilenames.includes(img.filename)) ||
      (img.hostedUrl && candidates.includes(img.hostedUrl)),
  );
  if (matched) return matched;

  // If create_post args carry a local image_path directly even before images[] had it:
  if (candidateFilenames.length > 0) {
    const fn = candidateFilenames[0];
    return addOrUpdateImage(images, {
      id: `arg-${fn}`,
      url: `${BACKEND_ORIGIN}/outputs/${fn}`,
      prompt: "Statistical Graph",
      imagePath: candidates.find((c) => c.includes(fn)) ?? fn,
      filename: fn,
    });
  }

  // Fallback to the most recently generated image in this conversation (e.g. when
  // Buffer posts text-only or the model showed the graph in chat just before approval).
  return images.length > 0 ? images[images.length - 1] : undefined;
}

type DbPost = {
  id: number;
  platform: string;
  text: string;
  image_path: string | null;
  image_url: string | null;
  post_url: string | null;
  data_source?: DataSourceType | null;
  data_source_label?: string | null;
};

function getPostStorageKey(post: { id?: string | number; url?: string | null; text?: string }): string {
  if (post.url) return `stat_agent_source_url_${post.url}`;
  if (post.text) {
    const snippet = post.text.slice(0, 40).replace(/[^a-zA-Z0-9]/g, "_");
    return `stat_agent_source_txt_${snippet}`;
  }
  return `stat_agent_source_id_${post.id ?? "unknown"}`;
}

function persistSourceCache(key: string, source: DataSourceType) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, source);
  } catch {
    // Ignore quota or private browsing errors
  }
}

function getCachedSource(key: string): DataSourceType | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const val = localStorage.getItem(key);
    if (val === "ons_mcp" || val === "web_search" || val === "both") {
      return val;
    }
  } catch {
    // Ignore storage errors
  }
  return undefined;
}

function inferDataSourceHeuristic(text?: string, hasImage?: boolean): DataSourceType {
  const t = (text || "").toLowerCase();
  const hasOns =
    t.includes("ons") ||
    t.includes("office for national statistics") ||
    t.includes("cpih") ||
    t.includes("census") ||
    t.includes("inflation") ||
    t.includes("gdp") ||
    t.includes("wellbeing") ||
    Boolean(hasImage);
  const hasWeb = t.includes("web") || t.includes("search") || t.includes("google");
  if (hasOns && hasWeb) return "both";
  if (hasOns) return "ons_mcp";
  if (hasWeb) return "web_search";
  return "ons_mcp";
}

function dbPostToEntry(row: DbPost): PostEntry {
  const filename = row.image_path ? row.image_path.split("/").pop() : undefined;
  const storageKey = getPostStorageKey({ id: row.id, url: row.post_url, text: row.text });

  let dataSource: DataSourceType | undefined =
    (row.data_source as DataSourceType) || getCachedSource(storageKey);

  if (!dataSource) {
    dataSource = inferDataSourceHeuristic(row.text, Boolean(row.image_path || row.image_url));
  }

  if (dataSource) {
    persistSourceCache(storageKey, dataSource);
  }

  return {
    id: `db-${row.id}`,
    text: row.text,
    platform: row.platform,
    url: row.post_url ?? undefined,
    failed: false,
    // Prefer local /outputs/<filename> over GCS image_url because the GCS bucket
    // has Public Access Prevention enforced and 403s in the browser (see LEARNINGS.md).
    imageUrl: (filename ? `${BACKEND_ORIGIN}/outputs/${filename}` : undefined) ?? row.image_url ?? undefined,
    dataSource,
  };
}

function collectGallery(
  messages: any[],
  state?: AgentState,
): { images: ImageEntry[]; posts: PostEntry[] } {
  const images: ImageEntry[] = [];
  const posts: PostEntry[] = [];
  const pending = new Map<string, { name: string; args: any }>();

  let currentTurnOns = false;
  let currentTurnWeb = false;

  const currentDataSource = (): DataSourceType | undefined => {
    if (currentTurnOns && currentTurnWeb) return "both";
    if (currentTurnOns) return "ons_mcp";
    if (currentTurnWeb) return "web_search";
    return state?.data_source ?? undefined;
  };

  for (const msg of messages) {
    if (msg.role === "assistant") {
      if (Array.isArray(msg.toolCalls)) {
        for (const call of msg.toolCalls) {
          const name = call.function?.name;
          if (name === "research_agent") currentTurnOns = true;
          if (name === "web_research_agent") currentTurnWeb = true;
          if (
            name === "generate_image" ||
            name === "draft_agent" ||
            name === "create_post" ||
            name === "buffer_create_post" ||
            name === "upload_image"
          ) {
            pending.set(call.id, { name, args: tryParseJSON(call.function?.arguments) });
          }
        }
      }
      // Extract any image markdown links rendered inline in the chatbot response
      // (e.g. ![post image](http://localhost:8000/outputs/post-123.png)). Because
      // generate_image runs inside draft_agent (AgentTool), its tool call is nested
      // and not emitted as a top-level toolCall in messages — so extracting from
      // the assistant message and draft_agent result captures the graph reliably.
      if (typeof msg.content === "string") {
        const matches = msg.content.matchAll(
          /(?:https?:\/\/[^\s)"']+)?\/outputs\/([^\s)"']+\.(?:png|jpe?g|webp|gif))/gi,
        );
        for (const m of matches) {
          const filename = m[1];
          if (filename) {
            addOrUpdateImage(images, {
              id: `chat-${filename}`,
              url: `${BACKEND_ORIGIN}/outputs/${filename}`,
              prompt: "Statistical Graph",
              imagePath: filename,
              filename,
            });
          }
        }
      }
    } else if (msg.role === "tool" && msg.toolCallId) {
      const call = pending.get(msg.toolCallId);
      if (!call) continue;
      const result = unwrapMcpContent(tryParseJSON(msg.content));
      const failed = Boolean(msg.error) || result?.isError === true || result?.status === "error";

      if (call.name === "generate_image") {
        if (!failed && result?.image_path) {
          const filename = String(result.image_path).split("/").pop();
          if (filename) {
            addOrUpdateImage(images, {
              id: msg.toolCallId,
              url: `${BACKEND_ORIGIN}/outputs/${filename}`,
              prompt: call.args?.prompt ?? "Statistical Graph",
              imagePath: result.image_path,
              filename,
            });
          }
        }
      } else if (call.name === "draft_agent" && !failed) {
        const rawText = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content ?? "");
        const matches = rawText.matchAll(
          /((?:post-image|post|chat-upload)-[a-z0-9-]+\.(?:png|jpe?g|webp|gif))/gi,
        );
        for (const m of matches) {
          const filename = m[1];
          if (filename) {
            addOrUpdateImage(images, {
              id: `draft-${filename}`,
              url: `${BACKEND_ORIGIN}/outputs/${filename}`,
              prompt: "Statistical Graph",
              imagePath: filename,
              filename,
            });
          }
        }
      } else if (call.name === "upload_image") {
        if (!failed && result?.url && call.args?.image_path) {
          const filename = extractOutputFilename(String(call.args.image_path));
          addOrUpdateImage(images, {
            id: `upload-${filename ?? msg.toolCallId}`,
            url: filename ? `${BACKEND_ORIGIN}/outputs/${filename}` : result.url,
            prompt: "Statistical Graph",
            imagePath: call.args.image_path,
            filename,
            hostedUrl: result.url,
            hostedDryRun: Boolean(result.dry_run),
          });
        }
      } else if ((call.name === "create_post" || call.name === "buffer_create_post") && !failed) {
        const matchedImg = findImageForPost(call.args, images);
        const postText = call.args?.text ?? "";
        const postUrl = result?.post_url ?? result?.url;
        const resolvedSource =
          currentDataSource() ?? inferDataSourceHeuristic(postText, Boolean(matchedImg?.url));

        const postEntry: PostEntry = {
          id: msg.toolCallId,
          text: postText,
          platform: inferPlatform(call.args, result),
          url: postUrl,
          failed: false,
          imageUrl: matchedImg?.url,
          dataSource: resolvedSource,
        };

        if (resolvedSource) {
          const storageKey = getPostStorageKey({
            id: msg.toolCallId,
            url: postUrl,
            text: postText,
          });
          persistSourceCache(storageKey, resolvedSource);
        }

        const normText = postText.trim();
        const existing = normText ? posts.find((p) => p.text.trim() === normText) : undefined;
        if (existing) {
          if (
            postEntry.platform.toLowerCase().includes("buffer") ||
            !existing.platform.toLowerCase().includes("buffer")
          ) {
            existing.platform = postEntry.platform;
          }
          existing.url = postEntry.url || existing.url;
          if (existing.platform.toLowerCase().includes("buffer") && existing.url?.includes("dryrun-")) {
            existing.url = undefined;
          }
          existing.imageUrl = postEntry.imageUrl || existing.imageUrl;
          existing.dataSource = postEntry.dataSource || existing.dataSource;
        } else {
          posts.push(postEntry);
        }
        currentTurnOns = false;
        currentTurnWeb = false;
      }
    }
  }

  // Merge any images tracked in backend session state (from _track_image_state).
  if (Array.isArray(state?.generated_images)) {
    for (const img of state.generated_images) {
      if (img?.url) {
        addOrUpdateImage(images, {
          id: img.id || img.url,
          url: toDisplayUrl(img.url),
          prompt: img.prompt || "Statistical Graph",
          imagePath: img.imagePath || img.url,
          hostedUrl: img.hostedUrl,
          hostedDryRun: img.hostedDryRun,
        });
      }
    }
  }
  if (state?.current_image_display_url) {
    addOrUpdateImage(images, {
      id: state.current_image_path || state.current_image_display_url,
      url: toDisplayUrl(state.current_image_display_url),
      prompt: "Statistical Graph",
      imagePath: state.current_image_path || state.current_image_display_url,
      hostedUrl: state.current_image_url ?? undefined,
    });
  }

  // Backfill imageUrl on any live post if state images were merged after the loop.
  if (images.length > 0) {
    for (const post of posts) {
      if (!post.imageUrl) {
        post.imageUrl = images[images.length - 1].url;
      }
    }
  }

  return { images, posts };
}

// Below this length a tile's text always fits within the 4-line clamp, so
// no "Read more" toggle is offered — avoids a button that would expand to
// reveal nothing new.
const TILE_TEXT_PREVIEW_LIMIT = 180;

function formatSourceBadge(source?: DataSourceType): { label: string; className: string } | null {
  if (source === "ons_mcp") {
    return { label: "🏛️ ONS MCP", className: "gallery-source gallery-source-ons" };
  }
  if (source === "both") {
    return { label: "🔗 ONS MCP + Web", className: "gallery-source gallery-source-both" };
  }
  if (source === "web_search") {
    return { label: "🌐 Web Search", className: "gallery-source gallery-source-web" };
  }
  return null;
}

function deduplicatePostEntries(entries: PostEntry[]): PostEntry[] {
  const result: PostEntry[] = [];
  const byText = new Map<string, PostEntry>();
  for (const entry of entries) {
    const key = entry.text.trim();
    if (!key) {
      result.push(entry);
      continue;
    }
    const existing = byText.get(key);
    if (!existing) {
      const clone = { ...entry };
      byText.set(key, clone);
      result.push(clone);
    } else {
      if (
        entry.platform.toLowerCase().includes("buffer") &&
        !existing.platform.toLowerCase().includes("buffer")
      ) {
        existing.platform = entry.platform;
      }
      existing.imageUrl = existing.imageUrl || entry.imageUrl;
      existing.dataSource = existing.dataSource || entry.dataSource;
      existing.url = existing.url || entry.url;
      if (existing.platform.toLowerCase().includes("buffer") && existing.url?.includes("dryrun-")) {
        existing.url = undefined;
      }
    }
  }
  return result;
}

export function PostGallery() {
  const { messages } = useCopilotChatInternal();
  const { state } = useCoAgent<AgentState>({ name: "social_poster" });
  const { posts: livePosts } = collectGallery((messages as any[]) ?? [], state);

  const [dbPosts, setDbPosts] = useState<PostEntry[]>([]);
  useEffect(() => {
    fetch(`${BACKEND_ORIGIN}/api/posts`)
      .then((r) => r.json())
      .then((data) => setDbPosts((data.posts ?? []).map(dbPostToEntry)))
      .catch(() => {
        // backend/db unreachable — the live-session list below still works
      });
  }, [livePosts.length, state?.pipeline_stage]);

  // Enrich livePosts with imageUrl and dataSource from dbPosts or cached provenance,
  // and deduplicate dbPosts that are already shown in livePosts.
  const enrichedLivePosts = livePosts.map((lp) => {
    const lpNorm = lp.text.trim();
    const dbMatch = dbPosts.find(
      (dp) => (lp.url && dp.url === lp.url) || (lpNorm && dp.text.trim() === lpNorm),
    );
    const storageKey = getPostStorageKey({ id: lp.id, url: lp.url, text: lp.text });
    const dataSource =
      lp.dataSource ||
      dbMatch?.dataSource ||
      getCachedSource(storageKey) ||
      inferDataSourceHeuristic(lp.text, Boolean(lp.imageUrl || dbMatch?.imageUrl));

    if (dataSource) {
      persistSourceCache(storageKey, dataSource);
    }

    return {
      ...lp,
      imageUrl: lp.imageUrl || dbMatch?.imageUrl,
      dataSource,
    };
  });

  const enrichedDbPosts = dbPosts.map((dp) => {
    if (dp.dataSource) return dp;
    const storageKey = getPostStorageKey({ id: dp.id, url: dp.url, text: dp.text });
    const ds =
      getCachedSource(storageKey) ||
      inferDataSourceHeuristic(dp.text, Boolean(dp.imageUrl));
    if (ds) persistSourceCache(storageKey, ds);
    return { ...dp, dataSource: ds };
  });

  const posts = deduplicatePostEntries([...enrichedLivePosts, ...enrichedDbPosts]);

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggleExpanded = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (posts.length === 0) {
    return null; // nothing approved yet — keep the dashboard uncluttered
  }

  return (
    <section className="card">
      <h2>Approved Posts &amp; Statistical Graphs</h2>
      <ul className="gallery-posts">
        {posts.map((p) => {
          const isExpanded = expanded.has(p.id);
          const isLong = p.text.length > TILE_TEXT_PREVIEW_LIMIT;
          const badge = formatSourceBadge(p.dataSource);
          return (
            <li key={p.id} className="gallery-tile">
              {p.imageUrl && (
                <button
                  type="button"
                  className="gallery-tile-image-btn"
                  title="Click to enlarge statistical graph"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="gallery-tile-image" src={p.imageUrl} alt="Statistical graph" />
                </button>
              )}
              <div className="gallery-tile-body">
                <div className="gallery-tile-meta">
                  <span className="gallery-platform">{p.platform}</span>
                  {badge && <span className={badge.className}>{badge.label}</span>}
                </div>
                <p className={isExpanded ? undefined : "gallery-tile-text"}>{p.text}</p>
                {isLong && (
                  <button
                    type="button"
                    className="gallery-readmore"
                    onClick={() => toggleExpanded(p.id)}
                  >
                    {isExpanded ? "Show less" : "Read more"}
                  </button>
                )}
                {p.url && (
                  <a href={p.url} target="_blank" rel="noreferrer">
                    view ↗
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
