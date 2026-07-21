import assert from "node:assert/strict";

import {
  analyzeProgress,
  parseProgressProperty,
  type ProgressProperty,
} from "./progress.ts";
import { detectDeadlocks } from "./reachability.ts";
import { parseStateMachine, type StateMachine } from "./state-machine.ts";

function machine(value: unknown): StateMachine {
  return parseStateMachine(value);
}

function property(value: unknown): ProgressProperty {
  return parseProgressProperty(value);
}

function check(system: StateMachine, properties: ProgressProperty[]) {
  return analyzeProgress(system, detectDeadlocks(system), properties);
}

const healthyWorker = machine({
  name: "healthy-worker",
  alphabet: ["job.accepted", "job.completed"],
  initial: 0,
  transitions: [
    { from: 0, action: "job.accepted", to: 1 },
    { from: 1, action: "job.completed", to: 0 },
  ],
});

const healthyResult = check(healthyWorker, [
  property({
    name: "completion-continues",
    type: "progress",
    actions: ["job.completed"],
  }),
  property({
    name: "accepted-implies-completion-progress",
    type: "conditional-progress",
    conditionActions: ["job.accepted"],
    progressActions: ["job.completed"],
  }),
]);
assert.equal(healthyResult.fairness, "fair-choice");
assert.equal(healthyResult.terminalComponents.length, 1);
assert(healthyResult.results.every((result) => result.satisfied));

const retryingWorker = machine({
  name: "retrying-worker",
  alphabet: ["start", "job.accepted", "job.retry", "job.completed"],
  initial: 0,
  transitions: [
    { from: 0, action: "start", to: 1 },
    { from: 1, action: "job.accepted", to: 2 },
    { from: 2, action: "job.retry", to: 1 },
  ],
});

const retryResult = check(retryingWorker, [
  property({
    name: "accepted-work-completes",
    type: "conditional-progress",
    conditionActions: ["job.accepted"],
    progressActions: ["job.completed"],
  }),
]);
assert.equal(retryResult.violations.length, 1);
assert.deepEqual(
  retryResult.violations[0]!.prefixTrace.map((step) => step.action),
  ["start"],
);
assert.deepEqual(retryResult.violations[0]!.terminalStates.sort(), [1, 2]);
assert.deepEqual(retryResult.violations[0]!.recurringActions, [
  "job.accepted",
  "job.retry",
]);
assert.deepEqual(retryResult.violations[0]!.missingProgressActions, [
  "job.completed",
]);

const vacuousWorker = machine({
  name: "vacuous-worker",
  alphabet: ["job.accepted", "job.retry", "job.completed"],
  initial: 0,
  transitions: [{ from: 0, action: "job.retry", to: 0 }],
});
const vacuousResult = check(vacuousWorker, [
  property({
    name: "accepted-work-completes",
    type: "conditional-progress",
    conditionActions: ["job.accepted"],
    progressActions: ["job.completed"],
  }),
]);
assert.equal(vacuousResult.results[0]!.satisfied, true);

const branchingWorker = machine({
  name: "branching-worker",
  alphabet: ["healthy", "degraded", "complete", "retry"],
  initial: 0,
  transitions: [
    { from: 0, action: "healthy", to: 1 },
    { from: 0, action: "degraded", to: 2 },
    { from: 1, action: "complete", to: 1 },
    { from: 2, action: "retry", to: 2 },
  ],
});
const branchingResult = check(branchingWorker, [
  property({
    name: "completion-continues",
    type: "progress",
    actions: ["complete"],
  }),
]);
assert.equal(branchingResult.terminalComponents.length, 2);
assert.equal(branchingResult.violations.length, 1);
assert.deepEqual(
  branchingResult.violations[0]!.prefixTrace.map((step) => step.action),
  ["degraded"],
);

const tauLivelock = machine({
  name: "tau-livelock",
  alphabet: ["tau", "complete"],
  initial: 0,
  transitions: [{ from: 0, action: "tau", to: 0 }],
});
const tauResult = check(tauLivelock, [
  property({
    name: "completion-continues",
    type: "progress",
    actions: ["complete"],
  }),
]);
assert.equal(tauResult.violations.length, 1);
assert.deepEqual(tauResult.violations[0]!.recurringActions, ["tau"]);
assert.deepEqual(tauResult.violations[0]!.prefixTrace, []);

const terminatingWorker = machine({
  name: "terminating-worker",
  alphabet: ["finish", "complete"],
  initial: 0,
  end: 1,
  transitions: [{ from: 0, action: "finish", to: 1 }],
});
const terminatingResult = check(terminatingWorker, [
  property({
    name: "completion-continues",
    type: "progress",
    actions: ["complete"],
  }),
]);
assert.equal(terminatingResult.terminalComponents.length, 0);
assert.equal(terminatingResult.results[0]!.satisfied, true);

const deadlockedWorker = machine({
  name: "deadlocked-worker",
  alphabet: ["complete"],
  initial: 0,
  transitions: [],
});
const deadlockedReachability = detectDeadlocks(deadlockedWorker);
const deadlockedResult = analyzeProgress(
  deadlockedWorker,
  deadlockedReachability,
  [
    property({
      name: "completion-continues",
      type: "progress",
      actions: ["complete"],
    }),
  ],
);
assert.equal(deadlockedReachability.deadlocks.length, 1);
assert.equal(deadlockedResult.terminalComponents.length, 0);
assert.equal(deadlockedResult.results[0]!.satisfied, true);

const unreachableCycle = machine({
  name: "unreachable-cycle",
  alphabet: ["work", "complete"],
  initial: 0,
  transitions: [
    { from: 0, action: "complete", to: 0 },
    { from: 9, action: "work", to: 9 },
  ],
});
const unreachableResult = check(unreachableCycle, [
  property({
    name: "completion-continues",
    type: "progress",
    actions: ["complete"],
  }),
]);
assert.equal(unreachableResult.terminalComponents.length, 1);
assert.equal(unreachableResult.results[0]!.satisfied, true);

assert.throws(
  () =>
    property({
      name: "internal-progress",
      type: "progress",
      actions: ["tau"],
    }),
  /must not include.*tau/i,
);
assert.throws(
  () =>
    check(healthyWorker, [
      property({
        name: "unknown-action",
        type: "progress",
        actions: ["job.lost"],
      }),
    ]),
  /not in the system alphabet/i,
);

console.log(
  "AnviLTS progress tests passed: fair-choice SCCs, conditional progress, witnesses, tau livelock, termination, and reachability.",
);
