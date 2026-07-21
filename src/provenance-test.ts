import assert from "node:assert/strict";

import { composeStateMachines } from "./compose.ts";
import { monitorProperty } from "./property.ts";
import { detectDeadlocks } from "./reachability.ts";
import { buildMachineDot } from "./render.ts";
import { parseStateMachine } from "./state-machine.ts";

const left = parseStateMachine({
  name: "left",
  alphabet: ["left.prepare", "commit"],
  initial: 0,
  transitions: [
    {
      from: 0,
      action: "left.prepare",
      to: 1,
      evidence: [
        {
          kind: "code",
          path: "src/left.ts",
          startLine: 10,
          endLine: 12,
          symbol: "prepare",
          explanation: "The worker records its local preparation before commit.",
        },
      ],
    },
    {
      from: 1,
      action: "commit",
      to: 2,
      evidence: [
        {
          kind: "code",
          path: "src/left.ts",
          startLine: 14,
          explanation: "The worker waits for the shared commit.",
        },
      ],
    },
  ],
  abstraction: {
    sourceRevision: "abc123",
    assumptions: ["The queue delivers each accepted command once."],
    omissions: ["Payload serialization is not modeled."],
    unresolved: [],
  },
});

const right = parseStateMachine({
  name: "right",
  alphabet: ["commit"],
  initial: 0,
  transitions: [
    {
      from: 0,
      action: "commit",
      to: 1,
      evidence: [
        {
          kind: "user-stated",
          explanation: "The operator confirmed that both workers commit together.",
        },
      ],
    },
  ],
  abstraction: {
    sourceRevision: "abc123",
    assumptions: [],
    omissions: [],
    unresolved: [],
  },
});

const composed = composeStateMachines([left, right]);
assert.equal(composed.abstraction?.sourceRevision, "abc123");
assert.deepEqual(composed.abstraction?.assumptions, [
  "The queue delivers each accepted command once.",
]);
const composedReachability = detectDeadlocks(composed);
assert.equal(composedReachability.deadlocks.length, 1);
assert.deepEqual(
  composedReachability.deadlocks[0]!.trace.map((transition) => transition.action),
  ["left.prepare", "commit"],
);
assert.equal(
  composedReachability.deadlocks[0]!.trace[0]!.evidence?.[0]?.kind,
  "code",
);
assert.deepEqual(
  composedReachability.deadlocks[0]!.trace[1]!.evidence?.map(
    (evidence) => evidence.kind,
  ),
  ["code", "user-stated"],
);

const system = parseStateMachine({
  name: "service",
  alphabet: ["enter"],
  initial: 0,
  transitions: [
    {
      from: 0,
      action: "enter",
      to: 1,
      evidence: [
        {
          kind: "code",
          path: "src/service.ts",
          startLine: 20,
          explanation: "The first request enters the critical section.",
        },
      ],
    },
    {
      from: 1,
      action: "enter",
      to: 1,
      evidence: [
        {
          kind: "code",
          path: "src/service.ts",
          startLine: 21,
          explanation: "A second request can enter before the first exits.",
        },
      ],
    },
  ],
});
const safetyProperty = parseStateMachine({
  name: "single-entry",
  alphabet: ["enter"],
  initial: 0,
  transitions: [
    {
      from: 0,
      action: "enter",
      to: 1,
      evidence: [
        {
          kind: "user-stated",
          explanation: "The user requires at most one active request.",
        },
      ],
    },
  ],
});
const monitored = monitorProperty(system, safetyProperty);
const violation = detectDeadlocks(monitored).violations[0]!;
assert.deepEqual(
  violation.trace.map((transition) => transition.action),
  ["enter", "enter"],
);
assert.deepEqual(
  violation.trace[1]!.evidence?.map((evidence) => evidence.kind),
  ["code", "derived"],
);
assert.match(
  violation.trace[1]!.evidence?.[1]?.explanation ?? "",
  /disallows.*enter/i,
);

const dot = buildMachineDot(left);
assert.match(dot, /tooltip=.*src\/left\.ts:10-12.*prepare/);

assert.throws(
  () =>
    parseStateMachine({
      name: "absolute-path",
      alphabet: ["go"],
      initial: 0,
      transitions: [
        {
          from: 0,
          action: "go",
          to: 1,
          evidence: [
            {
              kind: "code",
              path: "C:/repo/src/file.ts",
              startLine: 1,
              explanation: "Invalid non-portable citation.",
            },
          ],
        },
      ],
    }),
  /relative to the source repository/i,
);
assert.throws(
  () =>
    parseStateMachine({
      name: "bad-range",
      alphabet: ["go"],
      initial: 0,
      transitions: [
        {
          from: 0,
          action: "go",
          to: 1,
          evidence: [
            {
              kind: "code",
              path: "src/file.ts",
              startLine: 8,
              endLine: 7,
              explanation: "Invalid line range.",
            },
          ],
        },
      ],
    }),
  /at or after.*startLine/i,
);

console.log(
  "AnviLTS provenance tests passed: parsing, composition, safety products, counterexample traces, metadata, and graph tooltips.",
);
