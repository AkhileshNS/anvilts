import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  composeLtsTool,
  renderLtsTool,
  validateModelTool,
  verifyLtsTool,
} from "./tools.ts";

const stateSchema = z.union([
  z.number().int().nonnegative(),
  z.enum(["END", "ERROR"]),
  z.array(z.unknown()).min(1),
]);

const transitionSchema = z.object({
  from: stateSchema,
  action: z.string().min(1),
  to: stateSchema,
});

const machineSchema = z.object({
  name: z.string().min(1),
  alphabet: z.array(z.string().min(1)),
  initial: stateSchema,
  end: z.union([z.literal(-1), stateSchema]).optional(),
  transitions: z.array(transitionSchema),
});

const machinesSchema = z
  .array(machineSchema)
  .min(1)
  .describe("Component LTS definitions approved by the user.");

const actionSetSchema = z
  .array(z.string().min(1))
  .min(1)
  .describe('Observable action names; the internal action "tau" is not allowed.');

const progressPropertySchema = z.discriminatedUnion("type", [
  z.object({
    name: z.string().min(1),
    type: z.literal("progress"),
    actions: actionSetSchema.describe(
      "At least one of these actions must occur infinitely often.",
    ),
  }),
  z.object({
    name: z.string().min(1),
    type: z.literal("conditional-progress"),
    conditionActions: actionSetSchema.describe(
      "If any of these actions occurs infinitely often, progress is required.",
    ),
    progressActions: actionSetSchema.describe(
      "At least one of these actions must then occur infinitely often.",
    ),
  }),
]);

const maxStatesSchema = z
  .number()
  .int()
  .min(100)
  .max(500_000)
  .optional()
  .describe("Maximum reachable states before aborting; defaults to 100000.");

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function createAnviLtsServer(): McpServer {
  const server = new McpServer(
    { name: "anvilts", version: "0.1.0" },
    {
      instructions:
        "Deterministic labelled-transition-system validation, composition, safety and fair-choice progress verification, and visualization. Verify only a user-approved abstraction and describe results as claims about that model and its assumptions.",
    },
  );

  server.registerTool(
    "validate_model",
    {
      title: "Validate LTS model",
      description:
        "Validate component LTS JSON, an optional passive safety-property monitor, and optional LTSA-style progress properties before composition. Use after the user confirms the proposed components, actions, fairness assumptions, and verification question.",
      inputSchema: {
        machines: machinesSchema,
        property: machineSchema.optional(),
        progressProperties: z.array(progressPropertySchema).optional(),
      },
      annotations: readOnlyAnnotations,
    },
    validateModelTool,
  );

  server.registerTool(
    "compose_lts",
    {
      title: "Compose LTS components",
      description:
        "Construct the reachable parallel composition. Shared non-tau actions synchronize across all participating alphabets; private actions interleave; tau is always private.",
      inputSchema: {
        machines: machinesSchema.min(2),
        includeMachine: z
          .boolean()
          .optional()
          .describe("Include the full composite machine; defaults to false to keep results compact."),
        maxStates: maxStatesSchema,
      },
      annotations: readOnlyAnnotations,
    },
    composeLtsTool,
  );

  server.registerTool(
    "verify_lts",
    {
      title: "Verify concurrent model",
      description:
        "Exhaustively explore the reachable model, detecting deadlocks, reserved ERROR states, optional safety-monitor violations, and LTSA-style progress violations under fair-choice semantics. Returns shortest finite prefixes to failures or violating terminal components. This proves the approved finite abstraction, not source-code equivalence.",
      inputSchema: {
        machines: machinesSchema,
        property: machineSchema.optional(),
        progressProperties: z.array(progressPropertySchema).optional(),
        includeSystem: z
          .boolean()
          .optional()
          .describe("Include the full reachable system LTS; defaults to false."),
        maxStates: maxStatesSchema,
      },
      annotations: readOnlyAnnotations,
    },
    verifyLtsTool,
  );

  server.registerTool(
    "render_lts",
    {
      title: "Render LTS graph",
      description:
        "Render one LTS or a reachable composition as a dark SVG graph. Pass a verification trace to highlight its states and transitions for a visual counterexample.",
      inputSchema: {
        machines: machinesSchema,
        property: machineSchema
          .optional()
          .describe("Include the safety property when rendering a property-violation trace."),
        trace: z
          .array(transitionSchema)
          .optional()
          .describe("Optional counterexample trace returned by verify_lts."),
        highlightStates: z
          .array(stateSchema)
          .optional()
          .describe(
            "Optional recurrent terminal-component states returned by a progress violation.",
          ),
        orientation: z.enum(["horizontal", "vertical"]).optional(),
        maxStates: maxStatesSchema,
      },
      annotations: readOnlyAnnotations,
    },
    renderLtsTool,
  );

  return server;
}
