import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type, type TObject, type TProperties } from "@sinclair/typebox";
import {
  truncateHead,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
} from "@mariozechner/pi-coding-agent";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const BASE_URL = "https://api.figma.com";
const OAUTH_AUTH_URL = "https://www.figma.com/oauth";
const OAUTH_TOKEN_URL = "https://www.figma.com/api/oauth/token";

/* ── state ──────────────────────────────────────────────── */
let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

function getEnv(name: string): string | undefined {
  return process.env[name];
}

function getToken(): string {
  const pat = getEnv("FIGMA_ACCESS_TOKEN");
  if (pat) return pat;
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken;
  throw new Error(
    "No Figma access token.\nA) Set FIGMA_ACCESS_TOKEN env var, or\nB) Set FIGMA_CLIENT_ID + FIGMA_CLIENT_SECRET and run /figma-auth for OAuth."
  );
}

async function refreshOAuthToken(): Promise<string> {
  const [clientId, clientSecret, refreshToken] = [
    getEnv("FIGMA_CLIENT_ID"),
    getEnv("FIGMA_CLIENT_SECRET"),
    getEnv("FIGMA_REFRESH_TOKEN"),
  ];
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("OAuth credentials incomplete.");
  }

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || data.error) {
    throw new Error(
      `OAuth refresh failed: ${data.error_description ?? data.error ?? res.statusText}`
    );
  }

  _cachedToken = data.access_token;
  _tokenExpiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
  if (data.refresh_token) process.env.FIGMA_REFRESH_TOKEN = data.refresh_token;
  return _cachedToken;
}

async function exchangeCode(code: string) {
  const [clientId, clientSecret] = [getEnv("FIGMA_CLIENT_ID"), getEnv("FIGMA_CLIENT_SECRET")];
  const redirectUri = getEnv("FIGMA_REDIRECT_URI") ?? "http://localhost:3000/callback";
  if (!clientId || !clientSecret) throw new Error("FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET must be set.");

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || data.error) throw new Error(`OAuth exchange failed: ${data.error_description ?? data.error ?? res.statusText}`);
  _cachedToken = data.access_token;
  _tokenExpiresAt = Date.now() + data.expires_in * 1000;
  process.env.FIGMA_REFRESH_TOKEN = data.refresh_token;
  return data;
}

async function figmaFetch<T>(path: string, options: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "X-Figma-Token": token,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal,
  });

  if (res.status === 401 && getEnv("FIGMA_REFRESH_TOKEN")) {
    await refreshOAuthToken();
    return figmaFetch(path, options, signal);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${options.method ?? "GET"} ${path} => ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

function truncateJson(obj: unknown): string {
  const raw = JSON.stringify(obj, null, 2);
  const t = truncateHead(raw, { maxLines: DEFAULT_MAX_LINES, maxBytes: DEFAULT_MAX_BYTES });
  return t.truncated
    ? `${t.content}\n\n[Truncated: ${t.outputLines}/${t.totalLines} lines, ${formatSize(t.outputBytes)}/${formatSize(t.totalBytes)}]`
    : t.content;
}

/* ── factories ─────────────────────────────────────────── */

function readTool(
  pi: ExtensionAPI,
  name: string,
  label: string,
  description: string,
  pathFn: (p: any) => string,
) {
  pi.registerTool({
    name,
    label: `Figma: ${label}`,
    description,
    parameters: Type.Object({
      file_key: Type.String({ description: "Figma file key" }),
    }),
    async execute(_t, params: any, signal: any, _u: any, ctx: ExtensionContext) {
      const data = await figmaFetch<Record<string, unknown>>(pathFn(params), {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });
}

function makeReadTool(pi: ExtensionAPI, spec: {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters?: TObject;
  path: (params: any) => string;
  needsAuth?: boolean;
}) {
  pi.registerTool({
    name: spec.name,
    label: `Figma: ${spec.label}`,
    description: spec.description,
    promptSnippet: spec.promptSnippet,
    promptGuidelines: spec.promptGuidelines,
    parameters: spec.parameters,
    async execute(_t, params: any, signal: any, _u: any, ctx: ExtensionContext) {
      const data = await figmaFetch<Record<string, unknown>>(spec.path(params), {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: { summary: spec.name } };
    },
  });
}

function makeWriteTool(pi: ExtensionAPI, spec: {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  method: "POST" | "PUT" | "DELETE";
  parameters?: TObject;
  path: (params: any) => string;
  body?: (params: any) => Record<string, unknown> | undefined;
}) {
  pi.registerTool({
    name: spec.name,
    label: `Figma: ${spec.label}`,
    description: spec.description,
    promptSnippet: spec.promptSnippet,
    parameters: spec.parameters,
    async execute(_t, params: any, signal: any, _u: any, ctx: ExtensionContext) {
      const path = spec.path(params);
      const body = spec.body?.(params);
      const data = await figmaFetch<Record<string, unknown>>(
        path,
        { method: spec.method, ...(body && { body: JSON.stringify(body) }) },
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { success: true },
      };
    },
  });
}

/* ── extension entrypoint ───────────────────────────────── */

export default function (pi: ExtensionAPI) {
  /* ── auth command ────────────────────────────────────── */
  pi.registerCommand("figma-auth", {
    description: "Authenticate with Figma (PAT or OAuth)",
    handler: async (_args, ctx) => {
      if (getEnv("FIGMA_ACCESS_TOKEN")) {
        ctx.ui.notify("Using FIGMA_ACCESS_TOKEN (PAT).", "success");
        return;
      }
      const [clientId, clientSecret] = [getEnv("FIGMA_CLIENT_ID"), getEnv("FIGMA_CLIENT_SECRET")];
      if (!clientId || !clientSecret) {
        ctx.ui.notify("Missing FIGMA_CLIENT_ID and/or FIGMA_CLIENT_SECRET.", "error");
        return;
      }
      const redirectUri = getEnv("FIGMA_REDIRECT_URI") ?? "http://localhost:3000/callback";
      const scopes = "files:read file_content:read file_comments:write file_dev_resources:write file_variables:write";
      const state = btoa(Math.random().toString(36)).slice(0, 16);
      const authUrl = `${OAUTH_AUTH_URL}?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${state}&response_type=code`;
      ctx.ui.notify(`Open this URL to authorize: ${authUrl}`, "info");
      const code = await ctx.ui.input("Paste the authorization code:", "...");
      if (!code) { ctx.ui.notify("OAuth cancelled.", "warning"); return; }
      try {
        const r = await exchangeCode(code);
        ctx.ui.notify(`OAuth OK — token expires in ${r.expires_in}s.`, "success");
      } catch (e: any) { ctx.ui.notify(e.message, "error"); }
    },
  });

  pi.registerCommand("figma-to-react", {
    description: "Convert a Figma frame to a React + Tailwind component",
    handler: async (_args, ctx) => {
      const fileKey = await ctx.ui.input("Figma file key or URL:", "e.g. abc123...");
      if (!fileKey) { ctx.ui.notify("Cancelled.", "warning"); return; }
      const key = fileKey.replace(/^.*file\//, "").split("/")[0];
      ctx.ui.setWorkingMessage("Loading Figma file...");

      try {
        const summary = (await figmaFetch<any>(`/v1/files/${key}?depth=2`)).document.children
          .flatMap((page: any) =>
            page.children?.filter((c: any) => ["FRAME", "RECTANGLE", "COMPONENT", "INSTANCE", "SECTION", "GROUP"].includes(c.type)).map((f: any) => ({
              label: `${page.name} › ${f.name} (${f.type})`,
              value: f.id,
            }))
          )
          .filter(Boolean);
        if (!summary.length) { ctx.ui.notify("No frames or design nodes found.", "warning"); return; }

        const frameId = await ctx.ui.select("Pick a frame to convert:", summary.map((s: any) => s.label));
        if (!frameId) { ctx.ui.notify("Cancelled.", "warning"); return; }
        const selectedFrame = summary.find((s: any) => s.label === frameId)?.value;

        ctx.ui.setWorkingMessage("Exporting assets + tokens...");
        const [frameData, tokens, imageUrls] = await Promise.all([
          figmaFetch<any>(`/v1/files/${key}/nodes?ids=${encodeURIComponent(selectedFrame)}&depth=4`, {}, ctx.signal),
          figmaFetch<any>(`/v1/files/${key}/styles`, {}, ctx.signal).catch(() => null),
          figmaFetch<any>(`/v1/images/${key}?ids=${encodeURIComponent(selectedFrame)}&format=svg&scale=2`, {}, ctx.signal).catch(() => null),
        ]);

        const outDir = join(ctx.cwd, "figma-assets", key);
        await mkdir(outDir, { recursive: true });
        const downloadedAssets: Array<{ id: string; path: string }> = [];
        for (const [id, url] of Object.entries(imageUrls?.images ?? {})) {
          if (!url || typeof url !== "string") continue;
          const dest = join(outDir, `${id.replace(/:/g, "_")}.svg`);
          const img = await fetch(url, { signal: ctx.signal });
          if (!img.ok) continue;
          await writeFile(dest, new Uint8Array(await img.arrayBuffer()));
          downloadedAssets.push({ id, path: dest });
        }

        const designData = {
          file_key: key,
          file_name: fileRes.name,
          frame_id: selectedFrame,
          frame: frameData?.nodes?.[selectedFrame]?.document ?? null,
          tokens,
          assets: downloadedAssets,
          generated_at: new Date().toISOString(),
        };
        const designJsonPath = join(ctx.cwd, `${key}_${selectedFrame.replace(/:/g, "_")}_design.json`);
        await writeFile(designJsonPath, JSON.stringify(designData, null, 2));

        const payload = {
          file_key: key,
          frame_id: selectedFrame,
          frame: frameData?.nodes?.[selectedFrame]?.document ?? null,
          tokens,
          assets: downloadedAssets,
        };

        pi.sendUserMessage(
          `Design data loaded for frame \`${selectedFrame}\`. File: \`${key}\`. Assets: ${downloadedAssets.length} SVGs saved to \`${outDir}\`. Design JSON: \`${designJsonPath}\`.\n\nConvert this Figma frame into a React + Tailwind CSS component.`,
          { deliverAs: "followUp" }
        );
      } catch (e: any) {
        ctx.ui.notify(e.message, "error");
      } finally {
        ctx.ui.setWorkingMessage(undefined);
      }
    },
  });

  /* ─── FILES ─────────────────────────────────────────────── */

  pi.registerTool({
    name: "figma_get_file",
    label: "Figma: Get File",
    description:
      "Fetch the full JSON document of a Figma file. Use for inspecting design tree, nodes, frames, text, components. Optional version, ids, depth, geometry, plugin_data.",
    promptSnippet: "Read a Figma file's JSON document tree",
    promptGuidelines: [
      "Use figma_get_file when the user wants to inspect a Figma design, export its structure, or convert it to code.",
      "If the user only wants specific nodes, use figma_get_nodes instead.",
    ],
    parameters: Type.Object({
      file_key: Type.String(),
      version: Type.Optional(Type.String()),
      ids: Type.Optional(Type.String()),
      depth: Type.Optional(Type.Number()),
      geometry: Type.Optional(Type.String()),
      plugin_data: Type.Optional(Type.String()),
      branch_data: Type.Optional(Type.Boolean({ default: false })),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      if (params.version) qs.set("version", params.version);
      if (params.ids) qs.set("ids", params.ids);
      if (params.depth !== undefined) qs.set("depth", String(params.depth));
      if (params.geometry) qs.set("geometry", params.geometry);
      if (params.plugin_data) qs.set("plugin_data", params.plugin_data);
      if (params.branch_data) qs.set("branch_data", "true");
      const q = qs.toString();
      const data = await figmaFetch<any>(`/v1/files/${params.file_key}${q ? `?${q}` : ""}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: { summary: `file ${params.file_key}` } };
    },
  });

  pi.registerTool({
    name: "figma_get_nodes",
    label: "Figma: Get Nodes",
    description: "Fetch a subset of nodes. Smaller response than figma_get_file.",
    promptSnippet: "Read specific nodes from a Figma file",
    promptGuidelines: ["Prefer figma_get_nodes over figma_get_file when the user only needs specific frames or components."],
    parameters: Type.Object({
      file_key: Type.String(),
      ids: Type.String({ description: "Comma-separated node IDs" }),
      version: Type.Optional(Type.String()),
      depth: Type.Optional(Type.Number()),
      geometry: Type.Optional(Type.String()),
      plugin_data: Type.Optional(Type.String()),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      qs.set("ids", params.ids);
      if (params.version) qs.set("version", params.version);
      if (params.depth !== undefined) qs.set("depth", String(params.depth));
      if (params.geometry) qs.set("geometry", params.geometry);
      if (params.plugin_data) qs.set("plugin_data", params.plugin_data);
      const data = await figmaFetch<any>(`/v1/files/${params.file_key}/nodes?${qs.toString()}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  makeReadTool(pi, {
    name: "figma_get_file_meta",
    label: "Get File Meta",
    description: "Fetch metadata (name, lastModified, thumbnail, version) for a Figma file.",
    parameters: Type.Object({ file_key: Type.String() }),
    path: (p) => `/v1/files/${p.file_key}/meta`,
  });

  makeReadTool(pi, {
    name: "figma_get_versions",
    label: "Get Versions",
    description: "List version history of a Figma file.",
    parameters: Type.Object({ file_key: Type.String() }),
    path: (p) => `/v1/files/${p.file_key}/versions`,
  });

  /* ─── IMAGES ──────────────────────────────────────────── */

  pi.registerTool({
    name: "figma_get_images",
    label: "Figma: Export Images",
    description: "Export rendered images from nodes. Returns URLs to download.",
    promptSnippet: "Export images/assets from a Figma file",
    promptGuidelines: ["Use figma_get_images when the user wants logos, icons, or screenshots."],
    parameters: Type.Object({
      file_key: Type.String(),
      ids: Type.String({ description: "Comma-separated node IDs to render" }),
      scale: Type.Optional(Type.Number({ default: 1 })),
      format: Type.Optional(Type.String({ default: "png" })),
      svg_include_id: Type.Optional(Type.Boolean()),
      svg_simplify_stroke: Type.Optional(Type.Boolean()),
      use_absolute_bounds: Type.Optional(Type.Boolean()),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      qs.set("ids", params.ids);
      if (params.scale !== undefined) qs.set("scale", String(params.scale));
      if (params.format) qs.set("format", params.format);
      if (params.svg_include_id !== undefined) qs.set("svg_include_id", String(params.svg_include_id));
      if (params.svg_simplify_stroke !== undefined) qs.set("svg_simplify_stroke", String(params.svg_simplify_stroke));
      if (params.use_absolute_bounds !== undefined) qs.set("use_absolute_bounds", String(params.use_absolute_bounds));
      const data = await figmaFetch<any>(`/v1/images/${params.file_key}?${qs.toString()}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  pi.registerTool({
    name: "figma_get_file_images",
    label: "Figma: Get File Images (Fills)",
    description: "Get image fill blobs stored in a Figma file.",
    parameters: Type.Object({
      file_key: Type.String(),
      ids: Type.String({ description: "Comma-separated image fill IDs" }),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      qs.set("ids", params.ids);
      const data = await figmaFetch<any>(`/v1/files/${params.file_key}/images?${qs.toString()}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  /* ─── COMMENTS ────────────────────────────────────────── */

  makeReadTool(pi, {
    name: "figma_get_comment",
    label: "Get Comment",
    description: "Get a single comment by ID.",
    parameters: Type.Object({ file_key: Type.String(), comment_id: Type.String() }),
    path: (p) => `/v1/files/${p.file_key}/comments/${p.comment_id}`,
  });

  makeReadTool(pi, {
    name: "figma_get_comments",
    label: "Get Comments",
    description: "Read all comments on a Figma file.",
    promptSnippet: "Read comments on a Figma file",
    parameters: Type.Object({ file_key: Type.String() }),
    path: (p) => `/v1/files/${p.file_key}/comments`,
  });

  makeWriteTool(pi, {
    name: "figma_post_comment",
    label: "Post Comment",
    description: "Add a comment to a Figma file.",
    promptSnippet: "Write a comment on a Figma file",
    method: "POST",
    parameters: Type.Object({
      file_key: Type.String(),
      message: Type.String(),
      client_meta: Type.Optional(Type.String({ description: "JSON position metadata" })),
      comment_id: Type.Optional(Type.String({ description: "Reply to existing comment" })),
    }),
    path: (p) => `/v1/files/${p.file_key}/comments`,
    body: (p) => {
      const b: Record<string, unknown> = { message: p.message };
      if (p.client_meta) b.client_meta = JSON.parse(p.client_meta);
      if (p.comment_id) b.comment_id = p.comment_id;
      return b;
    },
  });

  makeWriteTool(pi, {
    name: "figma_update_comment",
    label: "Update Comment",
    description: "Edit an existing comment.",
    method: "PUT",
    parameters: Type.Object({ file_key: Type.String(), comment_id: Type.String(), message: Type.String() }),
    path: (p) => `/v1/files/${p.file_key}/comments/${p.comment_id}`,
    body: (p) => ({ message: p.message }),
  });

  makeWriteTool(pi, {
    name: "figma_delete_comment",
    label: "Delete Comment",
    description: "Delete a comment from a Figma file.",
    method: "DELETE",
    parameters: Type.Object({ file_key: Type.String(), comment_id: Type.String() }),
    path: (p) => `/v1/files/${p.file_key}/comments/${p.comment_id}`,
  });

  makeReadTool(pi, {
    name: "figma_get_comment_reactions",
    label: "Get Comment Reactions",
    description: "Get all reactions on a specific comment.",
    parameters: Type.Object({ file_key: Type.String(), comment_id: Type.String() }),
    path: (p) => `/v1/files/${p.file_key}/comments/${p.comment_id}/reactions`,
  });

  makeWriteTool(pi, {
    name: "figma_post_comment_reaction",
    label: "Post Comment Reaction",
    description: "Add an emoji reaction to a comment.",
    method: "POST",
    parameters: Type.Object({
      file_key: Type.String(),
      comment_id: Type.String(),
      emoji: Type.String({ description: "Shortcode: :thumbs_up:, :heart:, :hooray:" }),
    }),
    path: (p) => `/v1/files/${p.file_key}/comments/${p.comment_id}/reactions`,
    body: (p) => ({ emoji: p.emoji }),
  });

  makeWriteTool(pi, {
    name: "figma_delete_comment_reaction",
    label: "Delete Comment Reaction",
    description: "Remove your emoji reaction from a comment.",
    method: "DELETE",
    parameters: Type.Object({
      file_key: Type.String(),
      comment_id: Type.String(),
      emoji: Type.String(),
    }),
    path: (p) => `/v1/files/${p.file_key}/comments/${p.comment_id}/reactions/${encodeURIComponent(p.emoji)}`,
  });

  /* ─── PROJECTS ────────────────────────────────────────── */

  makeReadTool(pi, {
    name: "figma_get_team_projects",
    label: "Get Team Projects",
    description: "List all projects in a Figma team.",
    promptSnippet: "List Figma team projects",
    parameters: Type.Object({ team_id: Type.String() }),
    path: (p) => `/v1/teams/${p.team_id}/projects`,
  });

  makeReadTool(pi, {
    name: "figma_get_project_files",
    label: "Get Project Files",
    description: "List files inside a Figma project.",
    promptSnippet: "List files in a Figma project",
    parameters: Type.Object({ project_id: Type.String() }),
    path: (p) => `/v1/projects/${p.project_id}/files`,
  });

  /* ─── USERS ───────────────────────────────────────────── */

  makeReadTool(pi, {
    name: "figma_get_me",
    label: "Get Me",
    description: "Get information about the currently authenticated Figma user.",
    promptSnippet: "Get current Figma user info",
    parameters: Type.Object({}),
    path: () => "/v1/me",
  });

  /* ─── COMPONENTS ──────────────────────────────────────── */

  pi.registerTool({
    name: "figma_get_components",
    label: "Figma: Get Components",
    description: "List published components in a team or file.",
    promptSnippet: "List Figma components",
    parameters: Type.Object({
      scope: Type.String({ description: "team or file" }),
      key: Type.String({ description: "team_id or file_key" }),
    }),
    async execute(_t, params: any, signal: any) {
      const path = params.scope === "team" ? `/v1/teams/${params.key}/components` : `/v1/files/${params.key}/components`;
      const data = await figmaFetch<any>(path, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  makeReadTool(pi, {
    name: "figma_get_component",
    label: "Get Component",
    description: "Get metadata for a specific published component.",
    parameters: Type.Object({ component_key: Type.String() }),
    path: (p) => `/v1/components/${p.component_key}`,
  });

  pi.registerTool({
    name: "figma_get_component_sets",
    label: "Figma: Get Component Sets",
    description: "List published component sets in a team or file.",
    parameters: Type.Object({
      scope: Type.String({ description: "team or file" }),
      key: Type.String({ description: "team_id or file_key" }),
    }),
    async execute(_t, params: any, signal: any) {
      const path = params.scope === "team" ? `/v1/teams/${params.key}/component_sets` : `/v1/files/${params.key}/component_sets`;
      const data = await figmaFetch<any>(path, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  /* ─── STYLES ──────────────────────────────────────────── */

  pi.registerTool({
    name: "figma_get_styles",
    label: "Figma: Get Styles",
    description: "List published styles in a team or file.",
    promptSnippet: "List Figma styles",
    parameters: Type.Object({
      scope: Type.String({ description: "team or file" }),
      key: Type.String({ description: "team_id or file_key" }),
    }),
    async execute(_t, params: any, signal: any) {
      const path = params.scope === "team" ? `/v1/teams/${params.key}/styles` : `/v1/files/${params.key}/styles`;
      const data = await figmaFetch<any>(path, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  makeReadTool(pi, {
    name: "figma_get_style",
    label: "Get Style",
    description: "Get metadata for a specific published style.",
    parameters: Type.Object({ style_key: Type.String() }),
    path: (p) => `/v1/styles/${p.style_key}`,
  });

  /* ─── VARIABLES (Enterprise) ────────────────────────────── */

  makeReadTool(pi, {
    name: "figma_get_variables_local",
    label: "Get Local Variables",
    description: "Fetch local variables and collections in a file (Enterprise).",
    parameters: Type.Object({ file_key: Type.String() }),
    path: (p) => `/v1/files/${p.file_key}/variables/local`,
  });

  makeReadTool(pi, {
    name: "figma_get_variables_published",
    label: "Get Published Variables",
    description: "Fetch published library variables in a file (Enterprise).",
    parameters: Type.Object({ file_key: Type.String() }),
    path: (p) => `/v1/files/${p.file_key}/variables/published`,
  });

  makeWriteTool(pi, {
    name: "figma_post_variables",
    label: "Post Variables",
    description: "Create or update variables in a file (Enterprise).",
    promptSnippet: "Write design tokens/variables to a Figma file",
    method: "POST",
    parameters: Type.Object({
      file_key: Type.String(),
      variables: Type.String({ description: "JSON array of variable objects" }),
      variableCollections: Type.Optional(Type.String()),
      variableModes: Type.Optional(Type.String()),
    }),
    path: (p) => `/v1/files/${p.file_key}/variables`,
    body: (p) => {
      const b: Record<string, unknown> = { variables: JSON.parse(p.variables) };
      if (p.variableCollections) b.variableCollections = JSON.parse(p.variableCollections);
      if (p.variableModes) b.variableModes = JSON.parse(p.variableModes);
      return b;
    },
  });

  makeWriteTool(pi, {
    name: "figma_put_variables",
    label: "Put Variables",
    description: "Modify existing variables in a file (Enterprise).",
    method: "PUT",
    parameters: Type.Object({
      file_key: Type.String(),
      variables: Type.String({ description: "JSON array of variable objects" }),
      variableCollections: Type.Optional(Type.String()),
      variableModes: Type.Optional(Type.String()),
    }),
    path: (p) => `/v1/files/${p.file_key}/variables`,
    body: (p) => {
      const b: Record<string, unknown> = { variables: JSON.parse(p.variables) };
      if (p.variableCollections) b.variableCollections = JSON.parse(p.variableCollections);
      if (p.variableModes) b.variableModes = JSON.parse(p.variableModes);
      return b;
    },
  });

  /* ─── DEV RESOURCES ───────────────────────────────────── */

  pi.registerTool({
    name: "figma_get_dev_resources",
    label: "Figma: Get Dev Resources",
    description: "List dev resources attached to nodes in a file.",
    promptSnippet: "List dev resources in a Figma file",
    parameters: Type.Object({
      file_key: Type.String(),
      node_ids: Type.Optional(Type.String({ description: "Comma-separated node IDs" })),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      if (params.node_ids) qs.set("node_ids", params.node_ids);
      const q = qs.toString();
      const data = await figmaFetch<any>(`/v1/files/${params.file_key}/dev_resources${q ? `?${q}` : ""}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  makeWriteTool(pi, {
    name: "figma_post_dev_resource",
    label: "Post Dev Resource",
    description: "Attach a dev resource link to a node.",
    promptSnippet: "Add a dev resource link to a Figma node",
    method: "POST",
    parameters: Type.Object({
      file_key: Type.String(),
      node_id: Type.String(),
      name: Type.String(),
      url: Type.String(),
    }),
    path: (p) => `/v1/files/${p.file_key}/dev_resources`,
    body: (p) => ({ node_id: p.node_id, name: p.name, url: p.url }),
  });

  makeWriteTool(pi, {
    name: "figma_put_dev_resource",
    label: "Update Dev Resource",
    description: "Update an existing dev resource on a node.",
    method: "PUT",
    parameters: Type.Object({
      file_key: Type.String(),
      dev_resource_id: Type.String(),
      node_id: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      url: Type.Optional(Type.String()),
    }),
    path: (p) => `/v1/files/${p.file_key}/dev_resources/${p.dev_resource_id}`,
    body: (p) => {
      const b: Record<string, unknown> = {};
      if (p.node_id) b.node_id = p.node_id;
      if (p.name) b.name = p.name;
      if (p.url) b.url = p.url;
      return b;
    },
  });

  makeWriteTool(pi, {
    name: "figma_delete_dev_resource",
    label: "Delete Dev Resource",
    description: "Remove a dev resource from a Figma file.",
    method: "DELETE",
    parameters: Type.Object({ file_key: Type.String(), dev_resource_id: Type.String() }),
    path: (p) => `/v1/files/${p.file_key}/dev_resources/${p.dev_resource_id}`,
  });

  makeWriteTool(pi, {
    name: "figma_post_dev_resources",
    label: "Post Dev Resources (Bulk)",
    description: "Create dev resources across multiple files in one call.",
    method: "POST",
    parameters: Type.Object({
      dev_resources: Type.String({
        description: 'JSON array: [{"file_key":"...","node_id":"...","name":"...","url":"..."}]',
      }),
    }),
    path: () => "/v1/dev_resources",
    body: (p) => ({ dev_resources: JSON.parse(p.dev_resources) }),
  });

  /* ─── SMART TOOLS ─────────────────────────────────────── */

  pi.registerTool({
    name: "figma_export_assets",
    label: "Figma: Export & Download Assets",
    description: "Export images/SVGs and download them locally.",
    promptSnippet: "Download Figma assets to the local project",
    promptGuidelines: [
      "Use figma_export_assets when the user wants icons, logos, screenshots, or illustrations saved locally.",
      "Prefer svg for icons/logos and png with scale=2 for raster images.",
    ],
    parameters: Type.Object({
      file_key: Type.String(),
      ids: Type.String(),
      format: Type.Optional(Type.String({ default: "png" })),
      scale: Type.Optional(Type.Number({ default: 1 })),
      out_dir: Type.Optional(Type.String({ default: "assets" })),
      prefix: Type.Optional(Type.String()),
    }),
    async execute(_t, params: any, signal: any, _u: any, ctx: ExtensionContext) {
      const qs = new URLSearchParams();
      qs.set("ids", params.ids);
      if (params.format) qs.set("format", params.format);
      if (params.scale !== undefined) qs.set("scale", String(params.scale));
      const data = (await figmaFetch<any>(`/v1/images/${params.file_key}?${qs.toString()}`, {}, signal)) as {
        images?: Record<string, string>;
      };

      const images = data.images ?? {};
      const dir = join(ctx.cwd, params.out_dir ?? "assets");
      await mkdir(dir, { recursive: true });

      const downloaded: Array<{ id: string; url: string; path: string }> = [];
      for (const [id, url] of Object.entries(images)) {
        if (!url) continue;
        const ext = (params.format ?? "png").toLowerCase();
        const filename = `${params.prefix ?? ""}${id.replace(/:/g, "_")}.${ext}`;
        const dest = join(dir, filename);
        const imgRes = await fetch(url, { signal });
        if (!imgRes.ok) continue;
        await writeFile(dest, new Uint8Array(Buffer.from(await imgRes.arrayBuffer())));
        downloaded.push({ id, url, path: dest });
      }

      const summary = downloaded.map((d) => `- ${d.id} → ${d.path}`).join("\n");
      return {
        content: [{ type: "text", text: `Downloaded ${downloaded.length} asset(s) to ${dir}:\n${summary}` }],
        details: { downloaded },
      };
    },
  });

  pi.registerTool({
    name: "figma_extract_tokens",
    label: "Figma: Extract Design Tokens",
    description: "Fetch styles, variables, and tokens as structured design-token JSON.",
    promptSnippet: "Extract design tokens (colors, typography, spacing)",
    promptGuidelines: [
      "Use figma_extract_tokens when the user wants a theme config, Tailwind extension, or CSS variables.",
    ],
    parameters: Type.Object({
      file_key: Type.String(),
      include_variables: Type.Optional(Type.Boolean({ default: true })),
    }),
    async execute(_t, params: any, signal: any) {
      const [stylesRes, varsRes] = await Promise.all([
        figmaFetch<any>(`/v1/files/${params.file_key}/styles`, {}, signal).catch(() => ({ meta: { styles: [] } })),
        params.include_variables
          ? figmaFetch<any>(`/v1/files/${params.file_key}/variables/local`, {}, signal).catch(() => ({}))
          : Promise.resolve({}),
      ]);
      const tokens = {
        file_key: params.file_key,
        styles: stylesRes,
        variables: varsRes,
        generated_at: new Date().toISOString(),
      };
      return { content: [{ type: "text", text: truncateJson(tokens) }], details: tokens };
    },
  });

  pi.registerTool({
    name: "figma_screens_summary",
    label: "Figma: Screens Summary",
    description: "High-level summary of pages and top-level frames in a file.",
    promptSnippet: "Get an overview of screens/frames in a Figma file",
    promptGuidelines: [
      "Use figma_screens_summary as the first step when converting a Figma design to code.",
    ],
    parameters: Type.Object({ file_key: Type.String() }),
    async execute(_t, params: any, signal: any) {
      const data = (await figmaFetch<any>(`/v1/files/${params.file_key}?depth=2`, {}, signal)) as {
        name?: string;
        lastModified?: string;
        document?: {
          children?: Array<{
            name?: string;
            id?: string;
            type?: string;
            children?: Array<{ name?: string; id?: string; type?: string }>;
          }>;
        };
      };
      const pages =
        data.document?.children?.map((page) => ({
          name: page.name,
          id: page.id,
          frames: page.children
            ?.filter((c) => ["FRAME", "RECTANGLE", "COMPONENT", "INSTANCE", "SECTION", "GROUP"].includes(c.type || ""))
            .map((f) => ({ name: f.name, id: f.id })),
        })) ?? [];
      const summary = { file_name: data.name, last_modified: data.lastModified, pages };
      return { content: [{ type: "text", text: truncateJson(summary) }], details: summary };
    },
  });

  /* ─── PLUGIN COMPANION (local relay) ──────────────────── */

  async function sendPluginCmd(body: Record<string, unknown>) {
    const res = await fetch("http://localhost:8787/cmd", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean; error?: string; id?: string };
    if (!res.ok || !data.ok) throw new Error(data.error || `Relay returned ${res.status}`);
    return data;
  }

  pi.registerCommand("figma-relay", {
    description: "Start the Figma companion plugin WebSocket relay",
    handler: async (_args, ctx) => {
      ctx.ui.notify("To start the relay, run this in a separate terminal:", "info");
      ctx.ui.notify("  bun src/ws-relay.ts", "info");
      ctx.ui.notify("Then open the companion plugin in Figma (Import plugin from manifest.json).", "info");
    },
  });

  pi.registerTool({
    name: "figma_plugin_create_frame",
    label: "Plugin: Create Frame",
    description: "Create a frame in the open Figma file via the companion plugin.",
    parameters: Type.Object({
      name: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
      fills: Type.Optional(Type.String({ description: "JSON array of fills" })),
      layoutMode: Type.Optional(Type.String({ description: "HORIZONTAL or VERTICAL" })),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "createFrame",
        name: params.name,
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
        fills: params.fills ? JSON.parse(params.fills) : undefined,
        layoutMode: params.layoutMode,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_create_rectangle",
    label: "Plugin: Create Rectangle",
    description: "Create a rectangle in the open Figma file via the companion plugin.",
    parameters: Type.Object({
      name: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
      fills: Type.Optional(Type.String({ description: "JSON array of fills" })),
      cornerRadius: Type.Optional(Type.Number()),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "createRectangle",
        name: params.name,
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
        fills: params.fills ? JSON.parse(params.fills) : undefined,
        cornerRadius: params.cornerRadius,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_create_text",
    label: "Plugin: Create Text",
    description: "Create a text node in the open Figma file via the companion plugin.",
    parameters: Type.Object({
      name: Type.Optional(Type.String()),
      text: Type.String(),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      fontSize: Type.Optional(Type.Number()),
      fontFamily: Type.Optional(Type.String()),
      fontStyle: Type.Optional(Type.String()),
      fills: Type.Optional(Type.String({ description: "JSON array of fills" })),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "createText",
        name: params.name,
        text: params.text,
        x: params.x,
        y: params.y,
        fontSize: params.fontSize,
        fontFamily: params.fontFamily,
        fontStyle: params.fontStyle,
        fills: params.fills ? JSON.parse(params.fills) : undefined,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_fill",
    label: "Plugin: Set Fill",
    description: "Set the fill of an existing node.",
    parameters: Type.Object({
      node_id: Type.String(),
      fills: Type.String({ description: "JSON array of fills" }),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "setFill", node_id: params.node_id, fills: JSON.parse(params.fills) });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_position",
    label: "Plugin: Set Position",
    description: "Move an existing node to x, y.",
    parameters: Type.Object({
      node_id: Type.String(),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "setPosition", node_id: params.node_id, x: params.x, y: params.y });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_size",
    label: "Plugin: Set Size",
    description: "Resize an existing node.",
    parameters: Type.Object({
      node_id: Type.String(),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "setSize", node_id: params.node_id, width: params.width, height: params.height });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_delete_node",
    label: "Plugin: Delete Node",
    description: "Delete a node from the open Figma file.",
    parameters: Type.Object({ node_id: Type.String() }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "deleteNode", node_id: params.node_id });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_get_page_nodes",
    label: "Plugin: Get Page Nodes",
    description: "List all top-level nodes on the current page via the companion plugin.",
    parameters: Type.Object({}),
    async execute() {
      const data = await sendPluginCmd({ action: "getPageNodes" });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_create_ellipse",
    label: "Plugin: Create Ellipse",
    description: "Create an ellipse in the open Figma file via the companion plugin.",
    parameters: Type.Object({
      name: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
      fills: Type.Optional(Type.String({ description: "JSON array of fills" })),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "createEllipse",
        name: params.name,
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
        fills: params.fills ? JSON.parse(params.fills) : undefined,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_create_line",
    label: "Plugin: Create Line",
    description: "Create a line in the open Figma file via the companion plugin.",
    parameters: Type.Object({
      name: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      width: Type.Optional(Type.Number()),
      strokes: Type.Optional(Type.String({ description: "JSON array of strokes" })),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "createLine",
        name: params.name,
        x: params.x,
        y: params.y,
        width: params.width,
        strokes: params.strokes ? JSON.parse(params.strokes) : undefined,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_stroke",
    label: "Plugin: Set Stroke",
    description: "Set the stroke on an existing node.",
    parameters: Type.Object({
      node_id: Type.String(),
      strokes: Type.String({ description: "JSON array of strokes" }),
      stroke_weight: Type.Optional(Type.Number()),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "setStroke",
        node_id: params.node_id,
        strokes: JSON.parse(params.strokes),
        strokeWeight: params.stroke_weight,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_effect",
    label: "Plugin: Set Effect",
    description: "Set drop shadows/blur effects on an existing node.",
    parameters: Type.Object({
      node_id: Type.String(),
      effects: Type.String({ description: "JSON array of effects" }),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "setEffect",
        node_id: params.node_id,
        effects: JSON.parse(params.effects),
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_clone_node",
    label: "Plugin: Clone Node",
    description: "Duplicate an existing node in the open Figma file.",
    parameters: Type.Object({
      node_id: Type.String(),
      name: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "cloneNode",
        node_id: params.node_id,
        name: params.name,
        x: params.x,
        y: params.y,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_image_fill",
    label: "Plugin: Set Image Fill",
    description: "Upload an image and set it as the fill of a node.",
    parameters: Type.Object({
      node_id: Type.String(),
      image_bytes: Type.String({ description: "Base64-encoded image bytes" }),
      scale_mode: Type.Optional(Type.String({ description: "FILL, FIT, CROP, or TILE", default: "FILL" })),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "setImageFill",
        node_id: params.node_id,
        image_bytes: Array.from(Buffer.from(params.image_bytes, "base64")),
        scaleMode: params.scale_mode,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_create_component",
    label: "Plugin: Create Component",
    description: "Create a reusable component in the open Figma file.",
    parameters: Type.Object({
      name: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
      fills: Type.Optional(Type.String({ description: "JSON array of fills" })),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "createComponent",
        name: params.name,
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
        fills: params.fills ? JSON.parse(params.fills) : undefined,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_auto_layout",
    label: "Plugin: Set Auto Layout",
    description: "Configure Auto Layout on a frame or component.",
    parameters: Type.Object({
      node_id: Type.String(),
      layout_mode: Type.String({ description: "NONE, HORIZONTAL, or VERTICAL" }),
      primary_axis_align: Type.Optional(Type.String({ description: "MIN, CENTER, MAX, SPACE_BETWEEN, SPACE_AROUND" })),
      counter_axis_align: Type.Optional(Type.String({ description: "MIN, CENTER, MAX" })),
      item_spacing: Type.Optional(Type.Number()),
      padding_top: Type.Optional(Type.Number()),
      padding_bottom: Type.Optional(Type.Number()),
      padding_left: Type.Optional(Type.Number()),
      padding_right: Type.Optional(Type.Number()),
      layout_wrap: Type.Optional(Type.String({ description: "WRAP or NO_WRAP" })),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "setAutoLayout",
        node_id: params.node_id,
        layoutMode: params.layout_mode,
        primaryAxisAlignItems: params.primary_axis_align,
        counterAxisAlignItems: params.counter_axis_align,
        itemSpacing: params.item_spacing,
        paddingTop: params.padding_top,
        paddingBottom: params.padding_bottom,
        paddingLeft: params.padding_left,
        paddingRight: params.padding_right,
        layoutWrap: params.layout_wrap,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_export_node",
    label: "Plugin: Export Node",
    description: "Export a node as PNG, SVG, or PDF via the Figma Plugin API.",
    parameters: Type.Object({
      node_id: Type.String(),
      format: Type.String({ description: "PNG, SVG, or PDF" }),
      scale: Type.Optional(Type.Number({ default: 1 })),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "exportNode",
        node_id: params.node_id,
        format: params.format,
        scale: params.scale,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_text",
    label: "Plugin: Set Text",
    description: "Edit the content of an existing text node.",
    parameters: Type.Object({
      node_id: Type.String(),
      text: Type.String(),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "setText", node_id: params.node_id, text: params.text });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_corner_radius",
    label: "Plugin: Set Corner Radius",
    description: "Round the corners of a rectangle, frame, or component.",
    parameters: Type.Object({
      node_id: Type.String(),
      radius: Type.Number(),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "setCornerRadius", node_id: params.node_id, radius: params.radius });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_opacity",
    label: "Plugin: Set Opacity",
    description: "Set the overall opacity of a node (0-1).",
    parameters: Type.Object({
      node_id: Type.String(),
      opacity: Type.Number(),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "setOpacity", node_id: params.node_id, opacity: params.opacity });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_blend_mode",
    label: "Plugin: Set Blend Mode",
    description: "Set the blend mode of a node (PASS_THROUGH, NORMAL, DARKEN, MULTIPLY, etc.).",
    parameters: Type.Object({
      node_id: Type.String(),
      blend_mode: Type.String(),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "setBlendMode", node_id: params.node_id, blendMode: params.blend_mode });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_append_child",
    label: "Plugin: Append Child",
    description: "Move a node to become a child of another node.",
    parameters: Type.Object({
      parent_id: Type.String(),
      child_id: Type.String(),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "appendChild", parent_id: params.parent_id, child_id: params.child_id });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_create_group",
    label: "Plugin: Create Group",
    description: "Create a group containing existing nodes.",
    parameters: Type.Object({
      node_ids: Type.String({ description: "Comma-separated node IDs to group" }),
      name: Type.Optional(Type.String()),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "createGroup",
        node_ids: params.node_ids.split(",").map((s: string) => s.trim()),
        name: params.name,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_constraints",
    label: "Plugin: Set Constraints",
    description: "Set layout constraints on a node (responsive behavior).",
    parameters: Type.Object({
      node_id: Type.String(),
      horizontal: Type.String({ description: "MIN, CENTER, MAX, STRETCH, SCALE, LEFT_RIGHT" }),
      vertical: Type.String({ description: "MIN, CENTER, MAX, STRETCH, SCALE, TOP_BOTTOM" }),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "setConstraints",
        node_id: params.node_id,
        constraints: {
          horizontal: params.horizontal,
          vertical: params.vertical,
        },
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_create_section",
    label: "Plugin: Create Section",
    description: "Create a section container in the open Figma file.",
    parameters: Type.Object({
      name: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      width: Type.Optional(Type.Number()),
      height: Type.Optional(Type.Number()),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({
        action: "createSection",
        name: params.name,
        x: params.x,
        y: params.y,
        width: params.width,
        height: params.height,
      });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_rotation",
    label: "Plugin: Set Rotation",
    description: "Rotate a node by a specified angle in degrees.",
    parameters: Type.Object({
      node_id: Type.String(),
      rotation: Type.Number({ description: "Degrees (0-360)" }),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "setRotation", node_id: params.node_id, rotation: params.rotation });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_create_page",
    label: "Plugin: Create Page",
    description: "Create a new page in the Figma document.",
    parameters: Type.Object({
      name: Type.String(),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "createPage", name: params.name });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_set_plugin_data",
    label: "Plugin: Set Plugin Data",
    description: "Store key-value metadata on a node for design-to-code markers.",
    parameters: Type.Object({
      node_id: Type.String(),
      key: Type.String(),
      value: Type.String(),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "setPluginData", node_id: params.node_id, key: params.key, value: params.value });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  pi.registerTool({
    name: "figma_plugin_get_plugin_data",
    label: "Plugin: Get Plugin Data",
    description: "Retrieve metadata stored on a node.",
    parameters: Type.Object({
      node_id: Type.String(),
      key: Type.String(),
    }),
    async execute(_t, params: any) {
      const data = await sendPluginCmd({ action: "getPluginData", node_id: params.node_id, key: params.key });
      return { content: [{ type: "text", text: truncateJson(data) }], details: data };
    },
  });

  /* ─── ANALYTICS ─────────────────────────────────────── */

  pi.registerTool({
    name: "figma_get_component_actions",
    label: "Figma: Get Component Actions",
    description: "Get library analytics component action data (insert, detach, delete).",
    parameters: Type.Object({
      file_key: Type.String({ description: "Library file key" }),
      group_by: Type.String({ description: "component or team" }),
      start_date: Type.Optional(Type.String({ description: "YYYY-MM-DD" })),
      end_date: Type.Optional(Type.String({ description: "YYYY-MM-DD" })),
      cursor: Type.Optional(Type.String()),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      qs.set("group_by", params.group_by);
      if (params.start_date) qs.set("start_date", params.start_date);
      if (params.end_date) qs.set("end_date", params.end_date);
      if (params.cursor) qs.set("cursor", params.cursor);
      const data = await figmaFetch<any>(`/v1/analytics/libraries/${params.file_key}/component/actions?${qs.toString()}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  pi.registerTool({
    name: "figma_get_component_usages",
    label: "Figma: Get Component Usages",
    description: "Get library analytics component usage data (instances in files).",
    parameters: Type.Object({
      file_key: Type.String(),
      group_by: Type.String({ description: "component or team" }),
      start_date: Type.Optional(Type.String()),
      end_date: Type.Optional(Type.String()),
      cursor: Type.Optional(Type.String()),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      qs.set("group_by", params.group_by);
      if (params.start_date) qs.set("start_date", params.start_date);
      if (params.end_date) qs.set("end_date", params.end_date);
      if (params.cursor) qs.set("cursor", params.cursor);
      const data = await figmaFetch<any>(`/v1/analytics/libraries/${params.file_key}/component/usages?${qs.toString()}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  pi.registerTool({
    name: "figma_get_style_actions",
    label: "Figma: Get Style Actions",
    description: "Get library analytics style action data (apply, detach, modify).",
    parameters: Type.Object({
      file_key: Type.String(),
      group_by: Type.String({ description: "style or team" }),
      start_date: Type.Optional(Type.String()),
      end_date: Type.Optional(Type.String()),
      cursor: Type.Optional(Type.String()),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      qs.set("group_by", params.group_by);
      if (params.start_date) qs.set("start_date", params.start_date);
      if (params.end_date) qs.set("end_date", params.end_date);
      if (params.cursor) qs.set("cursor", params.cursor);
      const data = await figmaFetch<any>(`/v1/analytics/libraries/${params.file_key}/style/actions?${qs.toString()}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  pi.registerTool({
    name: "figma_get_style_usages",
    label: "Figma: Get Style Usages",
    description: "Get library analytics style usage data.",
    parameters: Type.Object({
      file_key: Type.String(),
      group_by: Type.String({ description: "style or team" }),
      start_date: Type.Optional(Type.String()),
      end_date: Type.Optional(Type.String()),
      cursor: Type.Optional(Type.String()),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      qs.set("group_by", params.group_by);
      if (params.start_date) qs.set("start_date", params.start_date);
      if (params.end_date) qs.set("end_date", params.end_date);
      if (params.cursor) qs.set("cursor", params.cursor);
      const data = await figmaFetch<any>(`/v1/analytics/libraries/${params.file_key}/style/usages?${qs.toString()}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  pi.registerTool({
    name: "figma_get_variable_actions",
    label: "Figma: Get Variable Actions",
    description: "Get library analytics variable action data (apply, detach, modify).",
    parameters: Type.Object({
      file_key: Type.String(),
      group_by: Type.String({ description: "variable or team" }),
      start_date: Type.Optional(Type.String()),
      end_date: Type.Optional(Type.String()),
      cursor: Type.Optional(Type.String()),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      qs.set("group_by", params.group_by);
      if (params.start_date) qs.set("start_date", params.start_date);
      if (params.end_date) qs.set("end_date", params.end_date);
      if (params.cursor) qs.set("cursor", params.cursor);
      const data = await figmaFetch<any>(`/v1/analytics/libraries/${params.file_key}/variable/actions?${qs.toString()}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  pi.registerTool({
    name: "figma_get_variable_usages",
    label: "Figma: Get Variable Usages",
    description: "Get library analytics variable usage data.",
    parameters: Type.Object({
      file_key: Type.String(),
      group_by: Type.String({ description: "variable or team" }),
      start_date: Type.Optional(Type.String()),
      end_date: Type.Optional(Type.String()),
      cursor: Type.Optional(Type.String()),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      qs.set("group_by", params.group_by);
      if (params.start_date) qs.set("start_date", params.start_date);
      if (params.end_date) qs.set("end_date", params.end_date);
      if (params.cursor) qs.set("cursor", params.cursor);
      const data = await figmaFetch<any>(`/v1/analytics/libraries/${params.file_key}/variable/usages?${qs.toString()}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  /* ─── WEBHOOKS ──────────────────────────────────────── */

  pi.registerTool({
    name: "figma_get_webhooks",
    label: "Figma: Get Webhooks",
    description: "List webhooks for a team, project, or file.",
    parameters: Type.Object({
      context: Type.Optional(Type.String({ description: "team, project, or file" })),
      context_id: Type.Optional(Type.String()),
      plan_api_id: Type.Optional(Type.String()),
      cursor: Type.Optional(Type.String()),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      if (params.context) qs.set("context", params.context);
      if (params.context_id) qs.set("context_id", params.context_id);
      if (params.plan_api_id) qs.set("plan_api_id", params.plan_api_id);
      if (params.cursor) qs.set("cursor", params.cursor);
      const q = qs.toString();
      const data = await figmaFetch<any>(`/v2/webhooks${q ? `?${q}` : ""}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  makeReadTool(pi, {
    name: "figma_get_webhook",
    label: "Get Webhook",
    description: "Get a single webhook by ID.",
    parameters: Type.Object({ webhook_id: Type.String() }),
    path: (p) => `/v2/webhooks/${p.webhook_id}`,
  });

  makeWriteTool(pi, {
    name: "figma_post_webhook",
    label: "Post Webhook",
    description: "Create a new webhook.",
    method: "POST",
    parameters: Type.Object({
      event_type: Type.String({ description: "FILE_COMMENT, FILE_UPDATE, FILE_VERSION_UPDATE, LIBRARY_PUBLISH, etc." }),
      team_id: Type.Optional(Type.String()),
      file_key: Type.Optional(Type.String()),
      passcode: Type.Optional(Type.String({ description: "Secret passcode for webhook verification" })),
      endpoint: Type.String({ description: "URL to POST events to" }),
    }),
    path: () => "/v2/webhooks",
    body: (p) => {
      const b: Record<string, unknown> = { event_type: p.event_type, endpoint: p.endpoint };
      if (p.team_id) b.team_id = p.team_id;
      if (p.file_key) b.file_key = p.file_key;
      if (p.passcode) b.passcode = p.passcode;
      return b;
    },
  });

  makeWriteTool(pi, {
    name: "figma_update_webhook",
    label: "Update Webhook",
    description: "Update an existing webhook (endpoint, status, passcode).",
    method: "PUT",
    parameters: Type.Object({
      webhook_id: Type.String(),
      endpoint: Type.Optional(Type.String()),
      status: Type.Optional(Type.String({ description: "ACTIVE or PAUSED" })),
      passcode: Type.Optional(Type.String()),
    }),
    path: (p) => `/v2/webhooks/${p.webhook_id}`,
    body: (p) => {
      const b: Record<string, unknown> = {};
      if (p.endpoint) b.endpoint = p.endpoint;
      if (p.status) b.status = p.status;
      if (p.passcode) b.passcode = p.passcode;
      return b;
    },
  });

  makeWriteTool(pi, {
    name: "figma_delete_webhook",
    label: "Delete Webhook",
    description: "Delete a webhook.",
    method: "DELETE",
    parameters: Type.Object({ webhook_id: Type.String() }),
    path: (p) => `/v2/webhooks/${p.webhook_id}`,
  });

  /* ─── OEMBED ──────────────────────────────────────────── */

  pi.registerTool({
    name: "figma_get_oembed",
    label: "Figma: Get oEmbed",
    description: "Get oEmbed data for a Figma file URL (title, thumbnail, author, etc.).",
    parameters: Type.Object({
      url: Type.String({ description: "Figma file URL" }),
      format: Type.Optional(Type.String({ default: "json" })),
      max_width: Type.Optional(Type.Number()),
      max_height: Type.Optional(Type.Number()),
    }),
    async execute(_t, params: any, signal: any) {
      const qs = new URLSearchParams();
      qs.set("url", params.url);
      if (params.format) qs.set("format", params.format);
      if (params.max_width !== undefined) qs.set("max_width", String(params.max_width));
      if (params.max_height !== undefined) qs.set("max_height", String(params.max_height));
      const data = await figmaFetch<any>(`/v1/oembed?${qs.toString()}`, {}, signal);
      return { content: [{ type: "text", text: truncateJson(data) }], details: {} };
    },
  });

  /* ─── STATUS ──────────────────────────────────────────── */

  pi.on("session_start", async (_event, ctx) => {
    try {
      getToken();
      ctx.ui.setStatus?.("figma", "🎨 Figma API ready");
    } catch {
      ctx.ui.setStatus?.("figma", "🎨 Figma API — token missing");
    }
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    ctx.ui.setStatus?.("figma", undefined);
  });
}
