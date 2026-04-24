# Deferred Optimizations for pi-figma

- [ ] **Webhooks support** — Add `figma_get_webhooks`, `figma_post_webhook`, `figma_delete_webhook` to reach 50+ tools
- [ ] **oEmbed support** — Add `figma_get_oembed` for embeddable file previews
- [ ] **Plugin node cloning** — `figma_plugin_clone_node` to duplicate existing nodes
- [ ] **Plugin image fill import** — `figma_plugin_set_image_fill` to import external images into Figma
- [ ] **Better token normalization** — `figma_extract_tokens` should output W3C design tokens format
- [ ] **Batch operations** — Allow plugin tools to accept arrays for bulk creation
- [ ] **Undo/redo awareness** — Group plugin commands into Figma transactions
- [ ] **Cloud relay** — Replace localhost relay with a Cloudflare Durable Object so plugin works without a local server
- [ ] **npm publish** — Package the extension for `pi install @moikapy/pi-figma`
