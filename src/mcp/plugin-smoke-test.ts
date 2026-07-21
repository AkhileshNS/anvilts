import assert from "node:assert/strict";
import { resolve } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const pluginDirectory = resolve("plugins/anvilts");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["./mcp/server.mjs"],
  cwd: pluginDirectory,
  stderr: "pipe",
});
const client = new Client({ name: "anvilts-plugin-smoke-test", version: "0.1.0" });

await client.connect(transport);

const tools = await client.listTools();
assert.equal(tools.tools.length, 4);

const coin = {
  name: "coin",
  alphabet: ["toss", "heads", "tails"],
  initial: 0,
  transitions: [
    { from: 0, action: "toss", to: 1 },
    { from: 0, action: "toss", to: 2 },
    { from: 1, action: "heads", to: 0 },
    { from: 2, action: "tails", to: 0 },
  ],
};

const rendering = (await client.callTool({
  name: "render_lts",
  arguments: { machines: [coin] },
})) as CallToolResult;
assert.equal(rendering.isError, undefined);
const svgResource = rendering.content.find((item) => item.type === "resource");
assert(svgResource && "text" in svgResource.resource);
assert.match(svgResource.resource.text, /<svg[\s>]/);

const progress = (await client.callTool({
  name: "verify_lts",
  arguments: {
    machines: [coin],
    progressProperties: [
      {
        name: "heads-continue",
        type: "progress",
        actions: ["heads"],
      },
    ],
  },
})) as CallToolResult;
assert.equal(progress.isError, undefined);
assert.equal(progress.structuredContent?.passed, true);
assert.equal(
  (progress.structuredContent?.progress as { fairness?: string } | undefined)
    ?.fairness,
  "fair-choice",
);

await client.close();

console.log(
  "Bundled AnviLTS plugin smoke test passed: stdio launch, 4 tools, fair-choice progress, and SVG render.",
);
