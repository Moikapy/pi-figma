/**
 * pi-figma WebSocket relay.
 * Bridges the pi extension (HTTP/WebSocket client) with the Figma companion plugin.
 *
 * Usage:
 *   bun src/ws-relay.ts
 *
 * Then in Figma, open the companion plugin. It will auto-connect to ws://localhost:8787.
 * The pi extension sends commands via HTTP POST to http://localhost:8787/cmd.
 */

const PORT = 8787;

let pluginSocket: any = null;

const server = Bun.serve({
  port: PORT,
  websocket: {
    open(ws) {
      pluginSocket = ws;
      console.log("[relay] 🎨 Figma plugin connected");
    },
    message(_ws, message) {
      console.log("[relay] ⬅️ from plugin:", String(message));
    },
    close() {
      pluginSocket = null;
      console.log("[relay] ❌ Figma plugin disconnected");
    },
  },
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const success = server.upgrade(req);
      if (success) return undefined;
    }

    // Health check
    if (url.pathname === "/") {
      return new Response(
        JSON.stringify({ status: "ok", plugin_connected: !!pluginSocket }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Command relay
    if (req.method === "POST" && url.pathname === "/cmd") {
      if (!pluginSocket) {
        return new Response(
          JSON.stringify({ ok: false, error: "Plugin not connected. Open the Figma companion plugin." }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        );
      }
      const body = await req.json();
      const envelope = { id: crypto.randomUUID(), ...body };
      pluginSocket.send(JSON.stringify(envelope));
      console.log("[relay] ➡️ to plugin:", JSON.stringify(envelope));
      return new Response(JSON.stringify({ ok: true, id: envelope.id }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("pi-figma relay", { status: 404 });
  },
});

console.log(`[relay] 🚀 ws://localhost:${PORT}/ws  |  http://localhost:${PORT}/cmd`);
