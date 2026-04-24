/**
 * pi-figma companion plugin — runs inside Figma.
 * Listens for commands from the pi extension via WebSocket relay.
 */

figma.showUI(__html__, { width: 300, height: 200 });

function post(type, payload) {
  figma.ui.postMessage({ type, payload });
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === "connected") {
    figma.notify("pi-figma companion connected 🎨");
    return;
  }
  if (msg.type === "disconnected") {
    figma.notify("pi-figma companion disconnected");
    return;
  }
  if (msg.type === "cmd") {
    const { id, action, ...params } = msg.payload;
    try {
      const result = await execute(action, params);
      post("result", { id, ok: true, result });
    } catch (err) {
      post("result", { id, ok: false, error: err.message || String(err) });
    }
  }
};

async function execute(action, params) {
  switch (action) {
    case "createFrame": {
      const n = figma.createFrame();
      n.name = params.name || "Frame";
      n.x = params.x ?? 0;
      n.y = params.y ?? 0;
      n.resize(params.width ?? 100, params.height ?? 100);
      if (params.fills) n.fills = params.fills;
      if (params.layoutMode) {
        n.layoutMode = params.layoutMode;
        n.primaryAxisAlignItems = params.primaryAxisAlignItems || "MIN";
        n.counterAxisAlignItems = params.counterAxisAlignItems || "MIN";
        n.itemSpacing = params.itemSpacing ?? 0;
        n.paddingTop = params.paddingTop ?? 0;
        n.paddingBottom = params.paddingBottom ?? 0;
        n.paddingLeft = params.paddingLeft ?? 0;
        n.paddingRight = params.paddingRight ?? 0;
      }
      figma.currentPage.appendChild(n);
      return { id: n.id, type: n.type, name: n.name };
    }
    case "createRectangle": {
      const n = figma.createRectangle();
      n.name = params.name || "Rectangle";
      n.x = params.x ?? 0;
      n.y = params.y ?? 0;
      n.resize(params.width ?? 100, params.height ?? 100);
      if (params.fills) n.fills = params.fills;
      if (params.strokes) n.strokes = params.strokes;
      if (params.effects) n.effects = params.effects;
      if (params.cornerRadius !== undefined) n.topLeftRadius = n.topRightRadius = n.bottomLeftRadius = n.bottomRightRadius = params.cornerRadius;
      figma.currentPage.appendChild(n);
      return { id: n.id, type: n.type, name: n.name };
    }
    case "createText": {
      const n = figma.createText();
      n.name = params.name || "Text";
      n.x = params.x ?? 0;
      n.y = params.y ?? 0;
      await figma.loadFontAsync({ family: params.fontFamily || "Inter", style: "Regular" });
      n.fontName = { family: params.fontFamily || "Inter", style: params.fontStyle || "Regular" };
      n.fontSize = params.fontSize ?? 16;
      n.characters = params.text || "";
      if (params.fills) n.fills = params.fills;
      if (params.textAlignHorizontal) n.textAlignHorizontal = params.textAlignHorizontal;
      figma.currentPage.appendChild(n);
      return { id: n.id, type: n.type, name: n.name };
    }
    case "createEllipse": {
      const n = figma.createEllipse();
      n.name = params.name || "Ellipse";
      n.x = params.x ?? 0;
      n.y = params.y ?? 0;
      n.resize(params.width ?? 100, params.height ?? 100);
      if (params.fills) n.fills = params.fills;
      figma.currentPage.appendChild(n);
      return { id: n.id, type: n.type, name: n.name };
    }
    case "createLine": {
      const n = figma.createLine();
      n.name = params.name || "Line";
      n.x = params.x ?? 0;
      n.y = params.y ?? 0;
      n.resize(params.width ?? 100, params.height ?? 0);
      if (params.strokes) n.strokes = params.strokes;
      figma.currentPage.appendChild(n);
      return { id: n.id, type: n.type, name: n.name };
    }
    case "setFill": {
      const node = figma.getNodeById(params.node_id);
      if (!node || !("fills" in node)) throw new Error("Node not found or does not support fills");
      node.fills = params.fills;
      return { id: node.id };
    }
    case "setStroke": {
      const node = figma.getNodeById(params.node_id);
      if (!node || !("strokes" in node)) throw new Error("Node not found or does not support strokes");
      node.strokes = params.strokes;
      if (params.strokeWeight !== undefined) node.strokeWeight = params.strokeWeight;
      return { id: node.id };
    }
    case "setEffect": {
      const node = figma.getNodeById(params.node_id);
      if (!node || !("effects" in node)) throw new Error("Node not found or does not support effects");
      node.effects = params.effects || [];
      return { id: node.id };
    }
    case "setPosition": {
      const node = figma.getNodeById(params.node_id);
      if (!node || !("x" in node)) throw new Error("Node not found or does not support position");
      if (params.x !== undefined) node.x = params.x;
      if (params.y !== undefined) node.y = params.y;
      return { id: node.id, x: node.x, y: node.y };
    }
    case "setSize": {
      const node = figma.getNodeById(params.node_id);
      if (!node || !("resize" in node)) throw new Error("Node not found or does not support resize");
      node.resize(params.width ?? node.width, params.height ?? node.height);
      return { id: node.id, width: node.width, height: node.height };
    }
    case "setText": {
      const node = figma.getNodeById(params.node_id);
      if (!node || node.type !== "TEXT") throw new Error("Node not found or not a text node");
      await figma.loadFontAsync(node.fontName);
      node.characters = params.text || "";
      return { id: node.id };
    }
    case "deleteNode": {
      const node = figma.getNodeById(params.node_id);
      if (!node) throw new Error("Node not found");
      node.remove();
      return { deleted: params.node_id };
    }
    case "appendChild": {
      const parent = figma.getNodeById(params.parent_id);
      const child = figma.getNodeById(params.child_id);
      if (!parent || !child) throw new Error("Parent or child not found");
      parent.appendChild(child);
      return { parent_id: parent.id, child_id: child.id };
    }
    case "getNode": {
      const node = figma.getNodeById(params.node_id);
      if (!node) throw new Error("Node not found");
      return { id: node.id, type: node.type, name: node.name };
    }
    case "getPageNodes": {
      return figma.currentPage.children.map((n) => ({ id: n.id, type: n.type, name: n.name }));
    }
    default:
      throw new Error(`Unknown action: ${action}`);
  }
}
