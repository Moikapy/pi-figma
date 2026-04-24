# Deferred Optimizations for pi-figma

- [x] **Webhooks support** (5 tools) — Added: get_webhooks, get_webhook, post_webhook, update_webhook, delete_webhook ✓
- [x] **oEmbed support** (1 tool) — Added: get_oembed ✓
- [ ] **Library Analytics** (6 tools) — component actions/usages, style actions/usages, variable actions/usages
- [ ] **Plugin node cloning** — `figma_plugin_clone_node` to duplicate existing nodes
- [ ] **Plugin image fill import** — `figma_plugin_set_image_fill` to import external images into Figma
- [ ] **Better token normalization** — `figma_extract_tokens` should output W3C design tokens format
- [ ] **Batch operations** — Allow plugin tools to accept arrays for bulk creation
- [ ] **Undo/redo awareness** — Group plugin commands into Figma transactions
- [ ] **Cloud relay** — Replace localhost relay with a Cloudflare Durable Object so plugin works without a local server
- [ ] **npm publish** — Package the extension for `pi install @moikapy/pi-figma`
