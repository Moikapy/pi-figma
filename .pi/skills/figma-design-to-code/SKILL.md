# Figma Design-to-Code Skill

Use this skill when the user wants to convert a Figma design into a web app (React, HTML, Vue, etc.) or extract design tokens.

## Workflow

1. **Auth check** — Ensure the user has set `FIGMA_ACCESS_TOKEN` or run `/figma-auth` to complete OAuth.
2. **Get the file** — Ask for the Figma file URL or `file_key`. Use `figma_get_file` with `depth=2` first to see high-level pages and frames without drowning in node data.
3. **Identify screens** — Look at `document.children` (pages). Each page has frames (`type: "FRAME"`). Note the frame names and `node-id`s.
4. **Export assets** — For logos, icons, and background images, use `figma_get_images` to get rendered PNG/SVG URLs.
5. **Deep-dive key frames** — Use `figma_get_nodes` with specific frame IDs to get layout details (AUTO_LAYOUT, constraints, padding, spacing).
6. **Extract tokens** — Call `figma_get_styles` and `figma_get_variables_local` to get color, typography, and spacing tokens. Map them to CSS custom properties or Tailwind config.
7. **Generate code** — Write React + Tailwind (or the target stack) based on the frame structure. Treat Figma frames as divs/components, text nodes as text, rectangles as divs with background colors.

## Figma Node Types Quick Reference

| Figma Type | Web Equivalent |
|-----------|----------------|
| `FRAME` | Container div / section / component root |
| `GROUP` | Logical grouping (often flatten into parent) |
| `RECTANGLE` | div with background/border/shadow |
| `TEXT` | `<p>`, `<span>`, `<h1>` etc. based on style |
| `VECTOR` | `<svg>` or `<img>` (export as SVG via `figma_get_images` with `format=svg`) |
| `COMPONENT` | Reusable React component |
| `INSTANCE` | Component instance (use the same React component) |
| `ELLIPSE` | `border-radius: 50%` div or SVG circle |
| `LINE` | `<hr>` or border div |
| `STAR`, `POLYGON` | SVG or CSS `clip-path` |
| `SECTION` | Page/section wrapper |

## Layout Translation

### Auto Layout
- `layoutMode: "HORIZONTAL"` → `flex flex-row`
- `layoutMode: "VERTICAL"` → `flex flex-col`
- `primaryAxisAlignItems: "SPACE_BETWEEN"` → `justify-between`
- `counterAxisAlignItems: "CENTER"` → `items-center`
- `itemSpacing` → `gap-{px}` (Tailwind) or `gap: {px}px`
- `paddingLeft/Right/Top/Bottom` → `p-...` or `px-...` / `py-...`
- `layoutWrap: "WRAP"` → `flex-wrap`

### Constraints
- `constraints.horizontal: "SCALE"` → width should be percentage-based
- `constraints.horizontal: "LEFT_RIGHT"` → `left-0 right-0` or `w-full`
- `constraints.vertical: "TOP_BOTTOM"` → `top-0 bottom-0` or `h-full`
- `constraints.horizontal: "CENTER"` → `mx-auto` or flex centering

### Absolute Positioning
If a node is inside a frame with `layoutMode: "NONE"`, use absolute positioning:
- `absolute left-[{x}px] top-[{y}px] w-[{w}px] h-[{h}px]`

## Text Translation
- `style.fontFamily` → `font-family` or closest Tailwind font stack
- `style.fontSize` → `text-[{px}px]` or nearest `text-sm/md/lg/etc`
- `style.fontWeight` → `font-normal`, `font-bold`, etc.
- `style.letterSpacing` → `tracking-[{em}em]`
- `style.lineHeightPx` → `leading-[{px}px]`
- `style.textAlignHorizontal` → `text-left`, `text-center`, `text-right`
- `style.fills` with solid color → `text-[#hex]`
- `characters` → inner text content

## Color & Fill Translation
- `fills` array with `type: "SOLID"` → `bg-[#hex]` or `text-[#hex]`
- `fills` with `type: "GRADIENT_LINEAR"` → CSS linear-gradient
- `fills` with `type: "IMAGE"` → `bg-[url(...)]` or `<img>`
- `strokes` → `border` properties
- `effects` with `type: "DROP_SHADOW"` → `shadow-lg` or `shadow-[...]`
- Opacity: `color.a * 100` → `/100` in Tailwind or `opacity-{val}`
- Use `opacity` property for overall node opacity

## Exporting Assets

Use `figma_get_images` with the right node IDs:
- Group multiple asset IDs into one call
- Use `format=svg` for icons and logos
- Use `format=png` and `scale=2` for retina images
- Download the returned URLs to the project's `public/` folder

## Image & Icon Nodes
- If `fills[0].type === "IMAGE"`, the node is an image
- `figma_get_file_images` returns fill URLs for images pasted into the canvas
- For `VECTOR` nodes, always export as SVG via `figma_get_images`

## Responsive Strategy
- If the design is mobile-first, use max-width container
- If desktop, use responsive breakpoints
- Figma constraints map to CSS Grid/Flexbox: `SCALE` → `%`, `FILL_CONTAINER` → `flex-grow`, `HUG_CONTENT` → `w-auto`

## Dev Resources (Write-back)
The REST API supports attaching dev resource links to nodes:
- Use `figma_post_dev_resource` to link a frame to the generated component file in GitHub/Storybook
- This creates a two-way bridge: design ↔ code

## Limitations
- The Figma REST API is read-only for design geometry. You CANNOT create frames, rectangles, or text via REST.
- Write operations are limited to: comments, comment reactions, variables (Enterprise), and dev resources.
- To push designs back to Figma, you need a companion Figma Plugin using the Plugin API.

## Design Token Extraction Example

```
1. figma_get_file with depth=1 → get document children (pages)
2. Pick page node IDs → figma_get_nodes with those IDs, depth=2
3. figma_get_styles (scope=file, key={file_key}) → color + text styles
4. figma_get_variables_local (Enterprise) → variable collections
5. Map:
   - style.name: "Primary/500" → --color-primary-500: #hex
   - style.fontSize: 16 → --text-base: 16px
   - frame.itemSpacing: 16 → --space-4: 16px
```

## Output Order
1. `README.md` with design tokens
2. `tailwind.config.ts` (or equivalent) with custom theme extensions
3. Component files (React/Vue/etc)
4. `public/` assets (downloaded images/icons)
5. Dev resource links back to Figma (optional)
