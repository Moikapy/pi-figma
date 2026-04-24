# Deferred Optimizations for pi-figma

## Done ✓
- [x] **Webhooks** (5 tools)
- [x] **oEmbed** (1 tool)
- [x] **Library Analytics** (6 tools)
- [x] **Core REST API** — Files, Nodes, Images, Comments, Projects, Users, Components, Styles, Variables, Dev Resources
- [x] **Design-to-code wizard** — /figma-to-react command
- [x] **Companion plugin** — 12 tools for direct design creation/modification

## Pending — needs companion plugin connected in Figma
- [ ] **Test plugin end-to-end** — create_frame, create_text, set_fill, etc. on user's moikas.com file
- [ ] **Plugin node cloning** — `figma_plugin_clone_node`
- [ ] **Plugin image fill import** — `figma_plugin_set_image_fill`
- [ ] **Undo/redo awareness** — Group plugin commands into Figma transactions

## Architecture — longer term
- [ ] **Batch operations** — Allow plugin tools to accept arrays for bulk creation
- [ ] **Cloud relay** — Replace localhost relay with a Cloudflare Durable Object
- [ ] **npm publish** — Package the extension for `pi install @moikapy/pi-figma`
- [ ] **Better token normalization** — `figma_extract_tokens` outputs W3C design tokens format
