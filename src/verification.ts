import { composeStateMachines } from "./compose.ts";
import { monitorProperty, type MonitoredState } from "./property.ts";
import {
  detectDeadlocks,
  type Deadlock,
  type ReachabilityResult,
} from "./reachability.ts";
import type { State, StateMachine, Transition } from "./state-machine.ts";

export type VerificationFindingKind =
  | "deadlock"
  | "property-violation"
  | "model-error";

export interface VerificationFinding {
  kind: VerificationFindingKind;
  title: string;
  description: string;
  trace: Transition[];
  state: State;
  monitored: boolean;
}

export interface PropertyVerification {
  definition: StateMachine;
  monitoredSystem: StateMachine<MonitoredState>;
  reachability: ReachabilityResult<MonitoredState>;
}

export interface VerificationReport {
  system: StateMachine;
  systemReachability: ReachabilityResult;
  property?: PropertyVerification;
  finding?: VerificationFinding;
  passed: boolean;
}

function findingFromDeadlock(deadlock: Deadlock): VerificationFinding {
  return {
    kind: "deadlock",
    title: "Reachable deadlock found",
    description:
      "The composed system reaches a non-terminating state with no eligible actions.",
    trace: deadlock.trace,
    state: deadlock.state,
    monitored: false,
  };
}

function findingFromModelError(violation: Deadlock): VerificationFinding {
  return {
    kind: "model-error",
    title: "Reachable ERROR state found",
    description:
      "A component reaches its reserved ERROR state along this execution path.",
    trace: violation.trace,
    state: violation.state,
    monitored: false,
  };
}

function findingFromPropertyViolation(
  violation: Deadlock<MonitoredState>,
  property: StateMachine,
): VerificationFinding {
  return {
    kind: "property-violation",
    title: `${property.name} is violated`,
    description:
      "The final action is not allowed by the safety monitor in its current state.",
    trace: violation.trace,
    state: violation.state,
    monitored: true,
  };
}

/**
 * Shared verification entry point for the CLI, frontend, and future API layer.
 * It checks the composed system for deadlocks and reserved ERROR states, then
 * independently checks an optional passive safety-property monitor.
 */
export function verifyStateMachines(
  machines: StateMachine[],
  propertyDefinition?: StateMachine,
): VerificationReport {
  if (machines.length === 0) {
    throw new Error("Verification requires at least one state machine.");
  }

  const system =
    machines.length === 1 ? machines[0]! : composeStateMachines(machines);
  const systemReachability = detectDeadlocks(system);
  let property: PropertyVerification | undefined;

  if (propertyDefinition) {
    const monitoredSystem = monitorProperty(system, propertyDefinition);
    property = {
      definition: propertyDefinition,
      monitoredSystem,
      reachability: detectDeadlocks(monitoredSystem),
    };
  }

  const propertyViolation = property?.reachability.violations[0];
  const modelError = systemReachability.violations[0];
  const deadlock = systemReachability.deadlocks[0];
  const finding = propertyViolation
    ? findingFromPropertyViolation(propertyViolation, property!.definition)
    : modelError
      ? findingFromModelError(modelError)
      : deadlock
        ? findingFromDeadlock(deadlock)
        : undefined;

  return {
    system,
    systemReachability,
    property,
    finding,
    passed: finding === undefined,
  };
}
