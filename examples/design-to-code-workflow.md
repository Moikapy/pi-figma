# Design-to-Code Workflow Example

This example shows how to use `pi-figma` to convert any Figma design into a web app.

## 1. Authenticate

```bash
export FIGMA_ACCESS_TOKEN="figd_..."
```

Or run `/figma-auth` in pi for OAuth.

## 2. Get a file overview

Paste a Figma URL or provide the file key:

```
figma_screens_summary(file_key="ABC123")
```

## 3. Pick a frame and export assets

```
figma_get_nodes(file_key="ABC123", ids="123:456", depth=4)
figma_export_assets(file_key="ABC123", ids="123:456,789:012", format="svg")
```

## 4. Extract design tokens

```
figma_extract_tokens(file_key="ABC123")
```

## 5. Generate code

The LLM will use the design data to write React + Tailwind components.

Or use the wizard:
```
/figma-to-react
```

## Modify designs directly (companion plugin)

1. Start relay: `bun src/ws-relay.ts`
2. Import `companion-plugin/manifest.json` in Figma
3. Use plugin tools:
```
figma_plugin_create_frame(name="Hero", x=0, y=0, width=1200, height=600)
figma_plugin_create_text(name="Headline", text="Hello World", x=100, y=100)
figma_plugin_set_fill(node_id="123:456", fills='[{"type":"SOLID","color":{"r":0,"g":0,"b":0}}]')
```
