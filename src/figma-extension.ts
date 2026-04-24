import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
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

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

function getEnv(name: string): string | undefined {
  return process.env[name];
}

function getToken(ctx?: ExtensionContext): string {
  // 1. Personal access token (fastest)
  const pat = getEnv("FIGMA_ACCESS_TOKEN");
  if (pat) return pat;

  // 2. Cached OAuth token
  if (_cachedToken && Date.now() < _tokenExpiresAt) {
    return _cachedToken;
  }

  // 3. No token available
  throw new Error(
    "No Figma access token available.\n" +
      "Option A: Set FIGMA_ACCESS_TOKEN env var (Personal Access Token).\n" +
      "Option B: Set FIGMA_CLIENT_ID + FIGMA_CLIENT_SECRET and run /figma-auth to complete OAuth."
  );
}

async function refreshOAuthToken(): Promise<string> {
  const clientId = getEnv("FIGMA_CLIENT_ID");
  const clientSecret = getEnv("FIGMA_CLIENT_SECRET");
  const refreshToken = getEnv("FIGMA_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "OAuth credentials incomplete. Need FIGMA_CLIENT_ID, FIGMA_CLIENT_SECRET, and FIGMA_REFRESH_TOKEN."
    );
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
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

  if (data.refresh_token) {
    // Update env for persistence (best-effort)
    process.env.FIGMA_REFRESH_TOKEN = data.refresh_token;
  }

  return _cachedToken;
}

async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const clientId = getEnv("FIGMA_CLIENT_ID");
  const clientSecret = getEnv("FIGMA_CLIENT_SECRET");
  const redirectUri = getEnv("FIGMA_REDIRECT_URI") ?? "http://localhost:3000/callback";
  if (!clientId || !clientSecret) {
    throw new Error("FIGMA_CLIENT_ID and FIGMA_CLIENT_SECRET must be set.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
    grant_type: "authorization_code",
  });

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || data.error) {
    throw new Error(
      `OAuth exchange failed: ${data.error_description ?? data.error ?? res.statusText}`
    );
  }

  _cachedToken = data.access_token;
  _tokenExpiresAt = Date.now() + data.expires_in * 1000;
  process.env.FIGMA_REFRESH_TOKEN = data.refresh_token;

  return data;
}

async function figmaFetch<T>(
  path: string,
  options: RequestInit = {},
  signal?: AbortSignal
): Promise<T> {
  const token = getToken();
  const url = `${BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "X-Figma-Token": token,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
    signal,
  });

  if (response.status === 401 && getEnv("FIGMA_REFRESH_TOKEN")) {
    // Try refreshing OAuth token once
    await refreshOAuthToken();
    return figmaFetch(path, options, signal);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Figma API ${options.method ?? "GET"} ${path} returned ${response.status}: ${body}`
    );
  }

  return (await response.json()) as T;
}

function truncateJson(obj: unknown): string {
  const raw = JSON.stringify(obj, null, 2);
  const t = truncateHead(raw, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (t.truncated) {
    return (
      t.content +
      `\n\n[Truncated: ${t.outputLines} of ${t.totalLines} lines, ${formatSize(t.outputBytes)} of ${formatSize(t.totalBytes)}]`
    );
  }
  return t.content;
}

export default function (pi: ExtensionAPI) {
  // ─── AUTH COMMAND ────────────────────────────────────────
  pi.registerCommand("figma-auth", {
    description: "Authenticate with Figma (PAT or OAuth)",
    handler: async (_args, ctx) => {
      const pat = getEnv("FIGMA_ACCESS_TOKEN");
      if (pat) {
        ctx.ui.notify("Using FIGMA_ACCESS_TOKEN (PAT).", "success");
        return;
      }

      const clientId = getEnv("FIGMA_CLIENT_ID");
      const clientSecret = getEnv("FIGMA_CLIENT_SECRET");
      if (!clientId || !clientSecret) {
        ctx.ui.notify(
          "Missing FIGMA_CLIENT_ID and/or FIGMA_CLIENT_SECRET. Add them to your .env and reload.",
          "error"
        );
        return;
      }

      const redirectUri = getEnv("FIGMA_REDIRECT_URI") ?? "http://localhost:3000/callback";
      const scopes = "files:read file_content:read file_comments:write file_dev_resources:write file_variables:write";
      const state = btoa(Math.random().toString(36)).slice(0, 16);
      const authUrl =
        `${OAUTH_AUTH_URL}?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&scope=${encodeURIComponent(scopes)}` +
        `&state=${state}` +
        `&response_type=code`;

      ctx.ui.notify(`Open this URL to authorize: ${authUrl}`, "info");
      const code = await ctx.ui.input(
        "Paste the authorization code from the callback URL:",
        "code from redirect..."
      );
      if (!code) {
        ctx.ui.notify("OAuth cancelled.", "warning");
        return;
      }

      try {
        const result = await exchangeCode(code);
        ctx.ui.notify(
          `OAuth success! Token expires in ${result.expires_in}s.`,
          "success"
        );
      } catch (err: any) {
        ctx.ui.notify(err.message, "error");
      }
    },
  });

  // ─── TOOLS ───────────────────────────────────────────────

  // Helper to check auth early and notify
  function checkAuth(ctx: ExtensionContext) {
    try {
      getToken(ctx);
    } catch (err: any) {
      ctx.ui.notify(err.message, "error");
      throw err;
    }
  }

  // ─── FILES ───────────────────────────────────────────────

  pi.registerTool({
    name: "figma_get_file",
    label: "Figma: Get File",
    description:
      "Fetch the full JSON document of a Figma file by its file_key. Use this to inspect the design tree, nodes, frames, text, and components. Optionally pass version, ids, depth, geometry, or plugin_data.",
    promptSnippet: "Read a Figma file's JSON document tree",
    promptGuidelines: [
      "Use figma_get_file when the user wants to inspect a Figma design, export its structure, or convert it to code.",
      "If the user only wants specific nodes, use figma_get_nodes instead to reduce response size.",
    ],
    parameters: Type.Object({
      file_key: Type.String({ description: "Figma file key from the URL" }),
      version: Type.Optional(Type.String({ description: "Specific version ID" })),
      ids: Type.Optional(
        Type.String({ description: "Comma-separated node IDs to filter" })
      ),
      depth: Type.Optional(
        Type.Number({ description: "Tree traversal depth" })
      ),
      geometry: Type.Optional(
        Type.String({ description: 'Set to "paths" to export vector data' })
      ),
      plugin_data: Type.Optional(
        Type.String({ description: "Comma-separated plugin IDs or 'shared'" })
      ),
      branch_data: Type.Optional(
        Type.Boolean({ description: "Include branch metadata", default: false })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const qs = new URLSearchParams();
      if (params.version) qs.set("version", params.version);
      if (params.ids) qs.set("ids", params.ids);
      if (params.depth !== undefined) qs.set("depth", String(params.depth));
      if (params.geometry) qs.set("geometry", params.geometry);
      if (params.plugin_data) qs.set("plugin_data", params.plugin_data);
      if (params.branch_data) qs.set("branch_data", "true");
      const query = qs.toString() ? `?${qs.toString()}` : "";
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}${query}`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { summary: `Retrieved file ${params.file_key}` },
      };
    },
  });

  pi.registerTool({
    name: "figma_get_nodes",
    label: "Figma: Get Nodes",
    description:
      "Fetch a subset of nodes from a Figma file. Much smaller response than figma_get_file when you only need specific frames or components.",
    promptSnippet: "Read specific nodes from a Figma file",
    promptGuidelines: [
      "Prefer figma_get_nodes over figma_get_file when the user only needs a specific screen, component, or frame.",
    ],
    parameters: Type.Object({
      file_key: Type.String({ description: "Figma file key" }),
      ids: Type.String({
        description: "Comma-separated node IDs (use %3A for colons in URL-safe IDs)",
      }),
      version: Type.Optional(Type.String()),
      depth: Type.Optional(Type.Number()),
      geometry: Type.Optional(Type.String()),
      plugin_data: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const qs = new URLSearchParams();
      qs.set("ids", params.ids);
      if (params.version) qs.set("version", params.version);
      if (params.depth !== undefined) qs.set("depth", String(params.depth));
      if (params.geometry) qs.set("geometry", params.geometry);
      if (params.plugin_data) qs.set("plugin_data", params.plugin_data);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/nodes?${qs.toString()}`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { summary: `Retrieved nodes from ${params.file_key}` },
      };
    },
  });

  pi.registerTool({
    name: "figma_get_file_meta",
    label: "Figma: Get File Meta",
    description: "Fetch metadata (name, lastModified, thumbnail, version, etc.) for a Figma file.",
    promptSnippet: "Get Figma file metadata",
    parameters: Type.Object({
      file_key: Type.String({ description: "Figma file key" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/meta`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { summary: `Retrieved metadata for ${params.file_key}` },
      };
    },
  });

  pi.registerTool({
    name: "figma_get_versions",
    label: "Figma: Get Versions",
    description: "List version history of a Figma file.",
    promptSnippet: "List Figma file version history",
    parameters: Type.Object({
      file_key: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/versions`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  // ─── IMAGES ──────────────────────────────────────────────

  pi.registerTool({
    name: "figma_get_images",
    label: "Figma: Export Images",
    description:
      "Export rendered images from a Figma file. Returns URLs you can download. Supports PNG, SVG, PDF.",
    promptSnippet: "Export images/assets from a Figma file",
    promptGuidelines: [
      "Use figma_get_images when the user wants logos, icons, or screenshots from a Figma design.",
    ],
    parameters: Type.Object({
      file_key: Type.String(),
      ids: Type.String({ description: "Comma-separated node IDs to render" }),
      scale: Type.Optional(Type.Number({ description: "Scale factor", default: 1 })),
      format: Type.Optional(
        Type.String({ description: "png, svg, pdf, or jpg", default: "png" })
      ),
      svg_include_id: Type.Optional(Type.Boolean()),
      svg_simplify_stroke: Type.Optional(Type.Boolean()),
      use_absolute_bounds: Type.Optional(Type.Boolean()),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const qs = new URLSearchParams();
      qs.set("ids", params.ids);
      if (params.scale !== undefined) qs.set("scale", String(params.scale));
      if (params.format) qs.set("format", params.format);
      if (params.svg_include_id !== undefined)
        qs.set("svg_include_id", String(params.svg_include_id));
      if (params.svg_simplify_stroke !== undefined)
        qs.set("svg_simplify_stroke", String(params.svg_simplify_stroke));
      if (params.use_absolute_bounds !== undefined)
        qs.set("use_absolute_bounds", String(params.use_absolute_bounds));
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/images/${params.file_key}?${qs.toString()}`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "figma_get_file_images",
    label: "Figma: Get File Images (Fills)",
    description:
      "Get image fills used in a Figma file (blobs stored by Figma for images pasted into the canvas).",
    parameters: Type.Object({
      file_key: Type.String(),
      ids: Type.String({ description: "Comma-separated image fill IDs" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const qs = new URLSearchParams();
      qs.set("ids", params.ids);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/images?${qs.toString()}`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  // ─── COMMENTS ────────────────────────────────────────────

  pi.registerTool({
    name: "figma_get_comments",
    label: "Figma: Get Comments",
    description: "Read all comments on a Figma file.",
    promptSnippet: "Read comments on a Figma file",
    parameters: Type.Object({
      file_key: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/comments`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "figma_post_comment",
    label: "Figma: Post Comment",
    description: "Add a comment to a Figma file.",
    promptSnippet: "Write a comment on a Figma file",
    parameters: Type.Object({
      file_key: Type.String(),
      message: Type.String(),
      client_meta: Type.Optional(
        Type.String({ description: 'JSON string of position metadata, e.g. {"x":100,"y":200} or {"node_id":"1:2","node_offset":{"x":0,"y":0}}' })
      ),
      comment_id: Type.Optional(
        Type.String({ description: "Reply to an existing comment" })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const body: Record<string, unknown> = { message: params.message };
      if (params.client_meta) body.client_meta = JSON.parse(params.client_meta);
      if (params.comment_id) body.comment_id = params.comment_id;
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/comments`,
        { method: "POST", body: JSON.stringify(body) },
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { success: true },
      };
    },
  });

  pi.registerTool({
    name: "figma_delete_comment",
    label: "Figma: Delete Comment",
    description: "Delete a comment from a Figma file.",
    parameters: Type.Object({
      file_key: Type.String(),
      comment_id: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/comments/${params.comment_id}`,
        { method: "DELETE" },
        signal
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { success: true },
      };
    },
  });

  // ─── PROJECTS ────────────────────────────────────────────

  pi.registerTool({
    name: "figma_get_team_projects",
    label: "Figma: Get Team Projects",
    description: "List all projects in a Figma team.",
    promptSnippet: "List Figma team projects",
    parameters: Type.Object({
      team_id: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/teams/${params.team_id}/projects`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "figma_get_project_files",
    label: "Figma: Get Project Files",
    description: "List files inside a Figma project.",
    promptSnippet: "List files in a Figma project",
    parameters: Type.Object({
      project_id: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/projects/${params.project_id}/files`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  // ─── USERS ───────────────────────────────────────────────

  pi.registerTool({
    name: "figma_get_me",
    label: "Figma: Get Me",
    description: "Get information about the currently authenticated Figma user.",
    promptSnippet: "Get current Figma user info",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>("/v1/me", {}, signal);
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  // ─── COMPONENTS ─────────────────────────────────────────

  pi.registerTool({
    name: "figma_get_components",
    label: "Figma: Get Components",
    description: "List published components in a team or file.",
    promptSnippet: "List Figma components",
    parameters: Type.Object({
      scope: Type.String({ description: "team or file" }),
      key: Type.String({ description: "team_id or file_key" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const path =
        params.scope === "team"
          ? `/v1/teams/${params.key}/components`
          : `/v1/files/${params.key}/components`;
      const data = await figmaFetch<Record<string, unknown>>(path, {}, signal);
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "figma_get_component",
    label: "Figma: Get Component",
    description: "Get metadata for a specific published component.",
    parameters: Type.Object({
      component_key: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/components/${params.component_key}`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "figma_get_component_sets",
    label: "Figma: Get Component Sets",
    description: "List published component sets in a team or file.",
    parameters: Type.Object({
      scope: Type.String({ description: "team or file" }),
      key: Type.String({ description: "team_id or file_key" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const path =
        params.scope === "team"
          ? `/v1/teams/${params.key}/component_sets`
          : `/v1/files/${params.key}/component_sets`;
      const data = await figmaFetch<Record<string, unknown>>(path, {}, signal);
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  // ─── STYLES ─────────────────────────────────────────────

  pi.registerTool({
    name: "figma_get_styles",
    label: "Figma: Get Styles",
    description: "List published styles in a team or file.",
    promptSnippet: "List Figma styles",
    parameters: Type.Object({
      scope: Type.String({ description: "team or file" }),
      key: Type.String({ description: "team_id or file_key" }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const path =
        params.scope === "team"
          ? `/v1/teams/${params.key}/styles`
          : `/v1/files/${params.key}/styles`;
      const data = await figmaFetch<Record<string, unknown>>(path, {}, signal);
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "figma_get_style",
    label: "Figma: Get Style",
    description: "Get metadata for a specific published style.",
    parameters: Type.Object({
      style_key: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/styles/${params.style_key}`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  // ─── VARIABLES (Enterprise) ────────────────────────────

  pi.registerTool({
    name: "figma_get_variables_local",
    label: "Figma: Get Local Variables",
    description: "Fetch local variables and variable collections in a file (Enterprise).",
    parameters: Type.Object({
      file_key: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/variables/local`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "figma_get_variables_published",
    label: "Figma: Get Published Variables",
    description: "Fetch published library variables available in a file (Enterprise).",
    parameters: Type.Object({
      file_key: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/variables/published`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "figma_post_variables",
    label: "Figma: Post Variables",
    description:
      "Create or update variables in a file (Enterprise). This is a write operation requiring Enterprise plan.",
    promptSnippet: "Write design tokens/variables to a Figma file",
    parameters: Type.Object({
      file_key: Type.String(),
      variables: Type.String({ description: "JSON string: array of variable objects" }),
      variableCollections: Type.Optional(
        Type.String({ description: "JSON string: array of variable collections" })
      ),
      variableModes: Type.Optional(
        Type.String({ description: "JSON string: array of variable modes" })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const body: Record<string, unknown> = { variables: JSON.parse(params.variables) };
      if (params.variableCollections)
        body.variableCollections = JSON.parse(params.variableCollections);
      if (params.variableModes) body.variableModes = JSON.parse(params.variableModes);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/variables`,
        { method: "POST", body: JSON.stringify(body) },
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { success: true },
      };
    },
  });

  // ─── DEV RESOURCES ─────────────────────────────────────

  pi.registerTool({
    name: "figma_get_dev_resources",
    label: "Figma: Get Dev Resources",
    description: "List dev resources (links to Jira, GitHub, Storybook, etc.) attached to nodes in a file.",
    promptSnippet: "List dev resources in a Figma file",
    parameters: Type.Object({
      file_key: Type.String(),
      node_ids: Type.Optional(
        Type.String({ description: "Comma-separated node IDs to filter" })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const qs = new URLSearchParams();
      if (params.node_ids) qs.set("node_ids", params.node_ids);
      const query = qs.toString() ? `?${qs.toString()}` : "";
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/dev_resources${query}`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "figma_post_dev_resource",
    label: "Figma: Post Dev Resource",
    description: "Attach a dev resource link to a node in a Figma file.",
    promptSnippet: "Add a dev resource link to a Figma node",
    parameters: Type.Object({
      file_key: Type.String(),
      node_id: Type.String(),
      name: Type.String(),
      url: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const body = {
        node_id: params.node_id,
        name: params.name,
        url: params.url,
      };
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/dev_resources`,
        { method: "POST", body: JSON.stringify(body) },
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { success: true },
      };
    },
  });

  pi.registerTool({
    name: "figma_delete_dev_resource",
    label: "Figma: Delete Dev Resource",
    description: "Remove a dev resource from a Figma file.",
    parameters: Type.Object({
      file_key: Type.String(),
      dev_resource_id: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/dev_resources/${params.dev_resource_id}`,
        { method: "DELETE" },
        signal
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { success: true },
      };
    },
  });

  // ─── SMART TOOLS ───────────────────────────────────────

  pi.registerTool({
    name: "figma_export_assets",
    label: "Figma: Export & Download Assets",
    description:
      "Export rendered images/SVGs from Figma nodes and download them to the local project. Creates an `assets/` folder and writes files there.",
    promptSnippet: "Download Figma assets to the local project",
    promptGuidelines: [
      "Use figma_export_assets when the user wants icons, logos, screenshots, or illustrations saved locally.",
      "Prefer svg for icons/logos and png with scale=2 for raster images.",
    ],
    parameters: Type.Object({
      file_key: Type.String(),
      ids: Type.String({ description: "Comma-separated node IDs" }),
      format: Type.Optional(
        Type.String({ description: "png, svg, pdf, jpg", default: "png" })
      ),
      scale: Type.Optional(Type.Number({ default: 1 })),
      out_dir: Type.Optional(
        Type.String({ description: "Output directory", default: "assets" })
      ),
      prefix: Type.Optional(
        Type.String({ description: "Filename prefix", default: "" })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const qs = new URLSearchParams();
      qs.set("ids", params.ids);
      if (params.format) qs.set("format", params.format);
      if (params.scale !== undefined) qs.set("scale", String(params.scale));
      const data = (await figmaFetch<Record<string, unknown>>(
        `/v1/images/${params.file_key}?${qs.toString()}`,
        {},
        signal
      )) as { images?: Record<string, string>; err?: string };

      const images = data.images ?? {};
      const dir = join(ctx.cwd, params.out_dir ?? "assets");
      await mkdir(dir, { recursive: true });

      const downloaded: Array<{ id: string; url: string; path: string }> = [];
      for (const [id, url] of Object.entries(images)) {
        if (!url) continue;
        const ext = (params.format ?? "png").toLowerCase();
        const name = `${params.prefix ?? ""}${id.replace(/:/g, "_")}.${ext}`;
        const path = join(dir, name);
        const img = await fetch(url, { signal });
        if (!img.ok) continue;
        const buf = Buffer.from(await img.arrayBuffer());
        await writeFile(path, new Uint8Array(buf));
        downloaded.push({ id, url, path });
      }

      const summary = downloaded
        .map((d) => `- ${d.id} → ${d.path}`)
        .join("\n");
      return {
        content: [
          {
            type: "text",
            text: `Downloaded ${downloaded.length} asset(s) to ${dir}:\n${summary}`,
          },
        ],
        details: { downloaded },
      };
    },
  });

  pi.registerTool({
    name: "figma_extract_tokens",
    label: "Figma: Extract Design Tokens",
    description:
      "Fetch styles, variables, and tokens from a Figma file and return them as a structured JSON design-token output.",
    promptSnippet: "Extract design tokens (colors, typography, spacing) from a Figma file",
    promptGuidelines: [
      "Use figma_extract_tokens when the user wants a theme config, Tailwind extension, or CSS variables from a design system.",
    ],
    parameters: Type.Object({
      file_key: Type.String(),
      include_variables: Type.Optional(Type.Boolean({ default: true })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const [stylesRes, varsRes] = await Promise.all([
        figmaFetch<Record<string, unknown>>(
          `/v1/files/${params.file_key}/styles`,
          {},
          signal
        ).catch(() => ({ meta: { styles: [] } }) as any),
        params.include_variables
          ? figmaFetch<Record<string, unknown>>(
              `/v1/files/${params.file_key}/variables/local`,
              {},
              signal
            ).catch(() => ({}))
          : Promise.resolve({}),
      ]);

      const tokens = {
        file_key: params.file_key,
        styles: stylesRes,
        variables: varsRes,
        generated_at: new Date().toISOString(),
      };

      return {
        content: [{ type: "text", text: truncateJson(tokens) }],
        details: tokens,
      };
    },
  });

  pi.registerTool({
    name: "figma_screens_summary",
    label: "Figma: Screens Summary",
    description:
      "Get a high-level summary of pages and top-level frames in a Figma file. Useful for understanding what screens exist before deep-diving.",
    promptSnippet: "Get an overview of screens/frames in a Figma file",
    promptGuidelines: [
      "Use figma_screens_summary as the first step when the user wants to convert a Figma design to code.",
    ],
    parameters: Type.Object({
      file_key: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = (await figmaFetch<any>(
        `/v1/files/${params.file_key}?depth=2`,
        {},
        signal
      )) as {
        name?: string;
        lastModified?: string;
        document?: {
          children?: Array<{
            name?: string;
            type?: string;
            id?: string;
            children?: Array<{ name?: string; type?: string; id?: string }>;
          }>;
        };
      };

      const pages =
        data.document?.children?.map((page) => ({
          name: page.name,
          id: page.id,
          frames: page.children
            ?.filter((c) => c.type === "FRAME")
            .map((f) => ({ name: f.name, id: f.id })),
        })) ?? [];

      const summary = {
        file_name: data.name,
        last_modified: data.lastModified,
        pages,
      };

      return {
        content: [{ type: "text", text: truncateJson(summary) }],
        details: summary,
      };
    },
  });

  // ─── WRITE-ENHANCED TOOLS ──────────────────────────────

  pi.registerTool({
    name: "figma_update_comment",
    label: "Figma: Update Comment",
    description: "Edit an existing comment on a Figma file.",
    parameters: Type.Object({
      file_key: Type.String(),
      comment_id: Type.String(),
      message: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/comments/${params.comment_id}`,
        { method: "PUT", body: JSON.stringify({ message: params.message }) },
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { success: true },
      };
    },
  });

  pi.registerTool({
    name: "figma_get_comment_reactions",
    label: "Figma: Get Comment Reactions",
    description: "Get all reactions on a specific comment.",
    parameters: Type.Object({
      file_key: Type.String(),
      comment_id: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/comments/${params.comment_id}/reactions`,
        {},
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "figma_post_comment_reaction",
    label: "Figma: Post Comment Reaction",
    description: "Add an emoji reaction to a comment.",
    parameters: Type.Object({
      file_key: Type.String(),
      comment_id: Type.String(),
      emoji: Type.String({ description: "Emoji shortcode: :thumbs_up:, :heart:, :hooray:, etc." }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/comments/${params.comment_id}/reactions`,
        { method: "POST", body: JSON.stringify({ emoji: params.emoji }) },
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { success: true },
      };
    },
  });

  pi.registerTool({
    name: "figma_delete_comment_reaction",
    label: "Figma: Delete Comment Reaction",
    description: "Remove your emoji reaction from a comment.",
    parameters: Type.Object({
      file_key: Type.String(),
      comment_id: Type.String(),
      emoji: Type.String(),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/comments/${params.comment_id}/reactions/${encodeURIComponent(params.emoji)}`,
        { method: "DELETE" },
        signal
      );
      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        details: { success: true },
      };
    },
  });

  pi.registerTool({
    name: "figma_put_variables",
    label: "Figma: Put Variables",
    description: "Modify existing variables in a file (Enterprise). Uses PUT semantics.",
    parameters: Type.Object({
      file_key: Type.String(),
      variables: Type.String({ description: "JSON string: array of variable objects to modify" }),
      variableCollections: Type.Optional(
        Type.String({ description: "JSON string: array of variable collections" })
      ),
      variableModes: Type.Optional(
        Type.String({ description: "JSON string: array of variable modes" })
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const body: Record<string, unknown> = { variables: JSON.parse(params.variables) };
      if (params.variableCollections)
        body.variableCollections = JSON.parse(params.variableCollections);
      if (params.variableModes) body.variableModes = JSON.parse(params.variableModes);
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/variables`,
        { method: "PUT", body: JSON.stringify(body) },
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { success: true },
      };
    },
  });

  pi.registerTool({
    name: "figma_put_dev_resource",
    label: "Figma: Update Dev Resource",
    description: "Update an existing dev resource on a node.",
    parameters: Type.Object({
      file_key: Type.String(),
      dev_resource_id: Type.String(),
      node_id: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      url: Type.Optional(Type.String()),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const body: Record<string, unknown> = {};
      if (params.node_id) body.node_id = params.node_id;
      if (params.name) body.name = params.name;
      if (params.url) body.url = params.url;
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/files/${params.file_key}/dev_resources/${params.dev_resource_id}`,
        { method: "PUT", body: JSON.stringify(body) },
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { success: true },
      };
    },
  });

  pi.registerTool({
    name: "figma_post_dev_resources",
    label: "Figma: Post Dev Resources (Bulk)",
    description:
      "Create dev resources across multiple files in one call. Each resource needs file_key, node_id, name, and url.",
    parameters: Type.Object({
      dev_resources: Type.String({
        description:
          'JSON string array: [{"file_key":"...","node_id":"...","name":"...","url":"..."}]',
      }),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      checkAuth(ctx);
      const body = { dev_resources: JSON.parse(params.dev_resources) };
      const data = await figmaFetch<Record<string, unknown>>(
        `/v1/dev_resources`,
        { method: "POST", body: JSON.stringify(body) },
        signal
      );
      return {
        content: [{ type: "text", text: truncateJson(data) }],
        details: { success: true },
      };
    },
  });

  // ─── STATUS ────────────────────────────────────────────

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
