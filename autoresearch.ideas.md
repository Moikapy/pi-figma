# Deferred Optimizations for pi-figma

## Done ✓
- [x] **Core REST API** — 46 tools: Files, Nodes, Images, Comments, Projects, Users, Components, Styles, Variables, Dev Resources, Webhooks, oEmbed, Analytics
- [x] **Design-to-code wizard** — /figma-to-react command
- [x] **Companion plugin** — 14 tools for direct design creation/modification (frame, rectangle, text, ellipse, line, clone, fills, strokes, effects, images, position, size, delete, page nodes)

## Pending — needs companion plugin connected in Figma
- [ ] **Test plugin end-to-end** — create_frame, create_text, set_fill on user's moikas.com file
- [ ] **Undo/redo awareness** — Group plugin commands into Figma transactions

## Architecture — longer term
- [ ] **Batch operations** — Plugin tools accept arrays for bulk creation
- [ ] **Cloud relay** — Cloudflare Durable Object for remote access
- [ ] **npm publish** — Package for `pi install @moikapy/pi-figma`
- [ ] **Better token normalization** — W3C design tokens format output
