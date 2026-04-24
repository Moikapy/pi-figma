# `pi-figma` — pi Extension for the Figma REST API

Repo: https://github.com/Moikapy/pi-figma

A [pi](https://github.com/badlogic/pi-mono) extension that turns Figma designs into web apps and vice versa. Provides **42 tools** covering the full Figma REST API surface plus a **companion Figma plugin** for direct design creation and modification.

## Features

- 📄 **Read designs** — files, nodes, frames, components, styles, variables, versions
- 🖼️ **Export assets** — PNG, SVG, JPG, PDF rendered exports downloaded to your project
- 💬 **Write comments** — post, delete, and read file comments
- 🎨 **Extract tokens** — design tokens (colors, typography, spacing) from styles + variables
- 📊 **Screens overview** — high-level summary of pages and frames before deep-diving
- 🧙 **Design-to-Code Wizard** — `/figma-to-react` command walks you through picking a frame and converting it to React + Tailwind
- 🔌 **Companion Plugin** — Create, modify, and delete Figma nodes directly via a local WebSocket relay (rectangles, frames, text, fills, etc.)
- 🔐 **OAuth + PAT** — personal access tokens or full OAuth 2.0 flow

## Install

Copy or symlink into your project's `.pi/extensions/`:

```bash
ln -s path/to/pi-figma/figma-extension.ts .pi/extensions/figma.ts
```

Or install via npm/git in `settings.json`:

```json
{
  "extensions": ["npm:@moikapy/pi-figma"]
}
```

Or clone and symlink:

```bash
git clone https://github.com/Moikapy/pi-figma.git
cd pi-figma
ln -s $(pwd)/src/figma-extension.ts ~/.pi/extensions/figma.ts
```

## Auth

### Option A: Personal Access Token (fastest)

1. Go to Figma → Settings → Personal access tokens → Generate
2. Export it:
   ```bash
   export FIGMA_ACCESS_TOKEN="figd_..."
   ```

### Option B: OAuth 2.0

1. Register an app at https://www.figma.com/developers/apps
2. Set environment variables:
   ```bash
   export FIGMA_CLIENT_ID="..."
   export FIGMA_CLIENT_SECRET="..."
   export FIGMA_REDIRECT_URI="http://localhost:3000/callback"
   ```
3. In pi, run `/figma-auth` and follow the flow.

## Commands

| Command | What it does |
|---------|-------------|
| `/figma-auth` | Authenticate with Figma (PAT or OAuth 2.0) |
| `/figma-to-react` | Interactive wizard: pick a frame → fetch data → generate React + Tailwind |
| `/figma-relay` | Show instructions for starting the companion plugin relay |

## Tools

| Tool | What it does | REST endpoint |
|------|-------------|---------------|
| `figma_get_file` | Full file JSON document | `GET /v1/files/:key` |
| `figma_get_nodes` | Specific nodes/subtrees | `GET /v1/files/:key/nodes` |
| `figma_get_file_meta` | Metadata (name, thumbnail, version) | `GET /v1/files/:key/meta` |
| `figma_get_versions` | Version history | `GET /v1/files/:key/versions` |
| `figma_get_images` | Export rendered images (returns URLs) | `GET /v1/images/:key` |
| `figma_get_file_images` | Image fill blobs | `GET /v1/files/:key/images` |
| `figma_export_assets` | Export AND download assets locally | `GET /v1/images/:key` + fs write |
| `figma_get_comments` | Read all file comments | `GET /v1/files/:key/comments` |
| `figma_get_comment` | Read a single comment | `GET /v1/files/:key/comments/:id` |
| `figma_post_comment` | Post a comment | `POST /v1/files/:key/comments` |
| `figma_update_comment` | Edit an existing comment | `PUT /v1/files/:key/comments/:id` |
| `figma_delete_comment` | Delete a comment | `DELETE /v1/files/:key/comments/:id` |
| `figma_get_comment_reactions` | Read comment reactions | `GET /v1/files/:key/comments/:id/reactions` |
| `figma_post_comment_reaction` | Add a reaction | `POST /v1/files/:key/comments/:id/reactions` |
| `figma_delete_comment_reaction` | Remove a reaction | `DELETE /v1/files/:key/comments/:id/reactions/:emoji` |
| `figma_get_team_projects` | List team projects | `GET /v1/teams/:id/projects` |
| `figma_get_project_files` | List files in a project | `GET /v1/projects/:id/files` |
| `figma_get_me` | Current user info | `GET /v1/me` |
| `figma_get_components` | Published components | `GET /v1/teams/:id/components` etc. |
| `figma_get_component` | Single component metadata | `GET /v1/components/:key` |
| `figma_get_component_sets` | Published component sets | `GET /v1/teams/:id/component_sets` etc. |
| `figma_get_styles` | Published styles | `GET /v1/teams/:id/styles` etc. |
| `figma_get_style` | Single style metadata | `GET /v1/styles/:key` |
| `figma_get_variables_local` | Local variables (Enterprise) | `GET /v1/files/:key/variables/local` |
| `figma_get_variables_published` | Published variables (Enterprise) | `GET /v1/files/:key/variables/published` |
| `figma_post_variables` | Create/update variables (Enterprise) | `POST /v1/files/:key/variables` |
| `figma_put_variables` | Modify existing variables (Enterprise) | `PUT /v1/files/:key/variables` |
| `figma_get_dev_resources` | Dev resource links on nodes | `GET /v1/files/:key/dev_resources` |
| `figma_post_dev_resource` | Attach a dev resource | `POST /v1/files/:key/dev_resources` |
| `figma_put_dev_resource` | Update an existing dev resource | `PUT /v1/files/:key/dev_resources/:id` |
| `figma_delete_dev_resource` | Remove a dev resource | `DELETE /v1/files/:key/dev_resources/:id` |
| `figma_post_dev_resources` | Bulk create dev resources (multi-file) | `POST /v1/dev_resources` |
| `figma_extract_tokens` | Smart composite: styles + variables JSON | Multiple |
| `figma_screens_summary` | Smart composite: pages + frames overview | `GET /v1/files/:key?depth=2` |

## Usage — Design to Code

1. Paste a Figma URL: `https://www.figma.com/file/ABC123/MyApp`
2. pi calls `figma_screens_summary` to list screens
3. pi calls `figma_get_nodes` on key frames to read layout
4. pi calls `figma_export_assets` to download logos/icons
5. pi calls `figma_extract_tokens` to generate the theme
6. pi writes React + Tailwind components from the design data

> 💡 See `.pi/skills/figma-design-to-code/SKILL.md` for detailed translation rules (Auto Layout → Flexbox, fills → Tailwind classes, etc.)

| `figma_plugin_create_frame` | Create a frame via companion plugin | Plugin API |
| `figma_plugin_create_rectangle` | Create a rectangle via companion plugin | Plugin API |
| `figma_plugin_create_text` | Create a text node via companion plugin | Plugin API |
| `figma_plugin_set_fill` | Set fill on an existing node | Plugin API |
| `figma_plugin_set_position` | Move an existing node | Plugin API |
| `figma_plugin_set_size` | Resize an existing node | Plugin API |
| `figma_plugin_delete_node` | Delete a node | Plugin API |
| `figma_plugin_get_page_nodes` | List top-level nodes on current page | Plugin API |

## Companion Plugin (Direct Design Modification)

The Figma REST API is read-only for design geometry. To **create or modify frames, rectangles, text, etc.**, use the companion plugin:

### 1. Start the relay

```bash
bun src/ws-relay.ts
```

### 2. Import the plugin in Figma

1. Open Figma Desktop or Browser
2. Right-click → Plugins → Development → Import plugin from manifest
3. Select `companion-plugin/manifest.json`
4. The plugin auto-connects to `ws://localhost:8787/ws`

### 3. Use pi tools

With the plugin open, pi tools like `figma_plugin_create_frame`, `figma_plugin_create_text`, `figma_plugin_set_fill` send commands through the relay and modify the open Figma file in real time.

The Figma REST API is **read-only for design geometry**. The extension supports all available write endpoints:

- Comments (POST / PUT / DELETE)
- Comment reactions (POST / DELETE)
- Variables (POST / PUT / DELETE) — Enterprise only
- Dev resources (POST / PUT / DELETE)

To actually **create or modify frames, rectangles, text, etc.** you need a companion [Figma Plugin](https://developers.figma.com/docs/plugins/) running inside Figma. The Plugin API has full write access, but it runs in Figma's sandbox, not in pi.

## Development

```bash
bun install
bun validate-tools.ts   # Count registered tools + test auth
bun test-extension.ts  # Live API smoke tests
```

## License

MIT
