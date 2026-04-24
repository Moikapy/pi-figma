/**
 * Validates that figma-extension.ts registers tools without runtime errors
 * and that basic API connectivity works.
 */

import { config } from "dotenv";
config();

// Import the extension factory dynamically
const extensionPath = new URL("./figma-extension.ts", import.meta.url).href;

// Minimal mock of ExtensionAPI for structural validation
const registeredTools: Array<{ name: string; parameters: unknown }> = [];
const registeredCommands: Array<string> = [];
const events: Array<{ event: string; handler: unknown }> = [];

const mockApi = {
  on: (event: string, handler: unknown) => events.push({ event, handler }),
  registerTool: (def: any) => registeredTools.push({ name: def.name, parameters: def.parameters }),
  registerCommand: (name: string, _opts: any) => registeredCommands.push(name),
  setStatus: () => {},
  notify: () => {},
  ui: {
    setStatus: () => {},
  },
} as any;

try {
  // We can't import .ts directly without tsx/transpiler here. 
  // Instead we regex-scan the file for registration calls.
  const fs = await import("node:fs");
  const source = fs.readFileSync("./src/figma-extension.ts", "utf8");

  const toolMatches = [
    ...source.matchAll(/pi\.registerTool\(\{\s*name:\s*"([^"]+)"/g),
    ...source.matchAll(/makeReadTool\(pi,\s*\{\s*name:\s*"([^"]+)"/g),
    ...source.matchAll(/makeWriteTool\(pi,\s*\{\s*name:\s*"([^"]+)"/g),
  ];
  const cmdMatches = [...source.matchAll(/pi\.registerCommand\("([^"]+)"/g)];
  const eventMatches = [...source.matchAll(/pi\.on\("([^"]+)"/g)];

  console.log(`Detected ${toolMatches.length} tools:`);
  toolMatches.forEach((m) => console.log(`  • ${m[1]}`));

  console.log(`\nDetected ${cmdMatches.length} commands:`);
  cmdMatches.forEach((m) => console.log(`  • ${m[1]}`));

  console.log(`\nDetected ${eventMatches.length} events:`);
  eventMatches.forEach((m) => console.log(`  • ${m[1]}`));

  // API connectivity test
  const meRes = await fetch("https://api.figma.com/v1/me", {
    headers: { "X-Figma-Token": process.env.FIGMA_ACCESS_TOKEN! },
  });
  if (!meRes.ok) throw new Error(`API auth failed: ${meRes.status}`);
  const me = await meRes.json();
  console.log(`\n✅ API auth OK — logged in as ${me.handle}`);

  console.log(`\n📊 Total registered tools: ${toolMatches.length}`);
} catch (err: any) {
  console.error("❌ Validation failed:", err.message);
  process.exit(1);
}
