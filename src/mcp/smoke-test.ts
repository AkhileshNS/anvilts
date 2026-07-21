import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { createAnviLtsServer } from "./registry.ts";

const workerA = {
  name: "worker-a",
  alphabet: ["a.enter", "a.exit"],
  initial: 0,
  transitions: [
    { from: 0, action: "a.enter", to: 1 },
    { from: 1, action: "a.exit", to: 0 },
  ],
};

const workerB = {
  name: "worker-b",
  alphabet: ["b.enter", "b.exit"],
  initial: 0,
  transitions: [
    { from: 0, action: "b.enter", to: 1 },
    { from: 1, action: "b.exit", to: 0 },
  ],
};

const mutexProperty = {
  name: "mutual-exclusion",
  alphabet: ["a.enter", "a.exit", "b.enter", "b.exit"],
  initial: 0,
  transitions: [
    { from: 0, action: "a.enter", to: 1 },
    { from: 0, action: "b.enter", to: 2 },
    { from: 1, action: "a.exit", to: 0 },
    { from: 2, action: "b.exit", to: 0 },
  ],
};

const server = createAnviLtsServer();
const client = new Client({ name: "anvilts-smoke-test", version: "0.1.0" });
const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

await server.connect(serverTransport);
await client.connect(clientTransport);

const tools = await client.listTools();
assert.deepEqual(
  tools.tools.map((tool) => tool.name).sort(),
  ["compose_lts", "render_lts", "validate_model", "verify_lts"],
);

const validation = (await client.callTool({
  name: "validate_model",
  arguments: { machines: [workerA, workerB], property: mutexProperty },
})) as CallToolResult;
assert.equal(validation.isError, undefined);
assert.equal(validation.structuredContent?.valid, true);

const verification = (await client.callTool({
  name: "verify_lts",
  arguments: { machines: [workerA, workerB], property: mutexProperty },
})) as CallToolResult;
assert.equal(verification.isError, undefined);
assert.equal(verification.structuredContent?.passed, false);
assert.equal(verification.structuredContent?.verdict, "property-violation");

const finding = verification.structuredContent?.finding as
  | { trace?: unknown[] }
  | undefined;
assert.equal(finding?.trace?.length, 2);

const rendering = (await client.callTool({
  name: "render_lts",
  arguments: {
    machines: [workerA, workerB],
    property: mutexProperty,
    trace: finding?.trace,
  },
})) as CallToolResult;
assert.equal(rendering.isError, undefined);
const svgResource = rendering.content.find((item) => item.type === "resource");
assert(svgResource && "text" in svgResource.resource);
assert.match(svgResource.resource.text, /<svg[\s>]/);

function cyclicCounter(name: string, action: string) {
  return {
    name,
    alphabet: [action],
    initial: 0,
    transitions: Array.from({ length: 11 }, (_, state) => ({
      from: state,
      action,
      to: (state + 1) % 11,
    })),
  };
}

const limitedComposition = (await client.callTool({
  name: "compose_lts",
  arguments: {
    machines: [cyclicCounter("left-counter", "left.tick"), cyclicCounter("right-counter", "right.tick")],
    maxStates: 100,
  },
})) as CallToolResult;
assert.equal(limitedComposition.isError, true);
assert.match(
  limitedComposition.content.find((item) => item.type === "text")?.text ?? "",
  /reachable-state limit/i,
);

await client.close();
await server.close();

console.log("AnviLTS MCP smoke test passed: 4 tools, counterexample, SVG, and state limit.");
