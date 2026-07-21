import { instance } from "@viz-js/viz";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { composeStateMachines } from "../compose.ts";
import { completeProperty, monitorProperty } from "../property.ts";
import { buildMachineDot, type GraphOrientation } from "../render.ts";
import {
  NO_END,
  isState,
  parseStateMachine,
  stateKey,
  type State,
  type StateMachine,
  type Transition,
} from "../state-machine.ts";
import {
  parseProgressProperty,
  validateProgressProperties,
  type ProgressProperty,
} from "../progress.ts";
import { verifyStateMachines } from "../verification.ts";

export const DEFAULT_MAX_STATES = 100_000;

interface CommonInput {
  machines: unknown[];
  maxStates?: number;
}

export interface ValidateInput extends CommonInput {
  property?: unknown;
  progressProperties?: unknown[];
}

export interface ComposeInput extends CommonInput {
  includeMachine?: boolean;
}

export interface VerifyInput extends CommonInput {
  includeSystem?: boolean;
  property?: unknown;
  progressProperties?: unknown[];
}

export interface RenderInput extends CommonInput {
  highlightStates?: unknown[];
  orientation?: GraphOrientation;
  property?: unknown;
  trace?: unknown[];
}

function toolResult(
  message: string,
  structuredContent: Record<string, unknown>,
  content: CallToolResult["content"] = [],
): CallToolResult {
  return {
    content: [{ type: "text", text: message }, ...content],
    structuredContent,
  };
}

function toolError(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `AnviLTS could not complete the check: ${message}` }],
    structuredContent: { error: message },
  };
}

function runSafely(
  operation: () => CallToolResult | Promise<CallToolResult>,
): Promise<CallToolResult> {
  try {
    return Promise.resolve(operation()).catch(toolError);
  } catch (error) {
    return Promise.resolve(toolError(error));
  }
}

function parseMachines(values: unknown[]): StateMachine[] {
  if (values.length === 0) {
    throw new Error("At least one state machine is required.");
  }

  const machines = values.map(parseStateMachine);
  const names = new Set(machines.map((machine) => machine.name));
  if (names.size !== machines.length) {
    throw new Error("State machine names must be unique.");
  }

  return machines;
}

function collectStates(machine: StateMachine): State[] {
  const states = new Map<string, State>();
  states.set(stateKey(machine.initial), machine.initial);
  if (machine.end !== NO_END) {
    states.set(stateKey(machine.end), machine.end);
  }
  for (const transition of machine.transitions) {
    states.set(stateKey(transition.from), transition.from);
    states.set(stateKey(transition.to), transition.to);
  }
  return [...states.values()];
}

function summarizeMachine(machine: StateMachine) {
  return {
    name: machine.name,
    states: collectStates(machine).length,
    transitions: machine.transitions.length,
    actions: machine.alphabet.length,
    alphabet: machine.alphabet,
    terminating: machine.end !== NO_END,
  };
}

function parseProperty(value: unknown | undefined): StateMachine | undefined {
  return value === undefined ? undefined : parseStateMachine(value);
}

function parseProgressProperties(values: unknown[] | undefined): ProgressProperty[] {
  return (values ?? []).map(parseProgressProperty);
}

function parseHighlightStates(values: unknown[] | undefined): State[] {
  if (!values) {
    return [];
  }

  return values.map((value, index) => {
    if (!isState(value)) {
      throw new Error(`Highlighted state ${index} is not a valid LTS state.`);
    }
    return value;
  });
}

function parseTrace(values: unknown[] | undefined): Transition[] {
  if (!values || values.length === 0) {
    return [];
  }

  const actions = values.flatMap((candidate) => {
    if (
      typeof candidate === "object" &&
      candidate !== null &&
      "action" in candidate &&
      typeof candidate.action === "string"
    ) {
      return [candidate.action];
    }
    return [];
  });
  const first = values[0];
  const initial =
    typeof first === "object" && first !== null && "from" in first
      ? first.from
      : undefined;
  const traceMachine = parseStateMachine({
    name: "counterexample-trace",
    alphabet: [...new Set(actions)],
    initial,
    end: NO_END,
    transitions: values,
  });
  return traceMachine.transitions;
}

function stateLimit(input: CommonInput): number {
  return input.maxStates ?? DEFAULT_MAX_STATES;
}

export function validateModelTool(input: ValidateInput): Promise<CallToolResult> {
  return runSafely(() => {
    const machines = parseMachines(input.machines);
    const property = parseProperty(input.property);
    const progressProperties = parseProgressProperties(input.progressProperties);
    const systemAlphabet = new Set(machines.flatMap((machine) => machine.alphabet));
    let completedProperty: StateMachine | undefined;

    if (property) {
      completedProperty = completeProperty(property);
      for (const action of property.alphabet) {
        if (action !== "tau" && !systemAlphabet.has(action)) {
          throw new Error(
            `Property action ${JSON.stringify(action)} is not in the system alphabet.`,
          );
        }
      }
    }
    validateProgressProperties(progressProperties, systemAlphabet);

    const result = {
      valid: true,
      components: machines.map(summarizeMachine),
      property: property
        ? {
            ...summarizeMachine(property),
            completedTransitions: completedProperty!.transitions.length,
          }
        : null,
      progressProperties: progressProperties.map((progress) => ({
        ...progress,
        fairness: "fair-choice",
      })),
      synchronization: {
        rule: "Non-tau actions synchronize across every component whose alphabet contains them; tau always interleaves privately.",
        sharedActions: [...systemAlphabet].filter(
          (action) =>
            action !== "tau" &&
            machines.filter((machine) => machine.alphabet.includes(action)).length > 1,
        ),
      },
    };

    return toolResult(
      `Validated ${machines.length} component${machines.length === 1 ? "" : "s"}${property ? " and one safety property" : ""}${progressProperties.length ? ` and ${progressProperties.length} progress propert${progressProperties.length === 1 ? "y" : "ies"}` : ""}.`,
      result,
    );
  });
}

export function composeLtsTool(input: ComposeInput): Promise<CallToolResult> {
  return runSafely(() => {
    const machines = parseMachines(input.machines);
    if (machines.length < 2) {
      throw new Error("Composition requires at least two state machines.");
    }

    const composite = composeStateMachines(machines, {
      maxStates: stateLimit(input),
    });
    const summary = summarizeMachine(composite);
    const result: Record<string, unknown> = {
      composed: true,
      components: machines.map((machine) => machine.name),
      summary,
    };
    if (input.includeMachine) {
      result.machine = composite;
    }

    return toolResult(
      `Composed ${machines.map((machine) => machine.name).join(", ")} into ${summary.states} reachable states and ${summary.transitions} transitions.`,
      result,
    );
  });
}

export function verifyLtsTool(input: VerifyInput): Promise<CallToolResult> {
  return runSafely(() => {
    const machines = parseMachines(input.machines);
    const property = parseProperty(input.property);
    const progressProperties = parseProgressProperties(input.progressProperties);
    const report = verifyStateMachines(machines, property, {
      maxStates: stateLimit(input),
      progressProperties,
    });
    const finding = report.finding
      ? {
          kind: report.finding.kind,
          title: report.finding.title,
          description: report.finding.description,
          state: report.finding.state,
          trace: report.finding.trace,
          actions: report.finding.trace.map((step) => step.action),
          terminalStates: report.finding.terminalStates ?? null,
          recurringActions: report.finding.recurringActions ?? null,
          fairness: report.finding.fairness ?? null,
        }
      : null;
    const result: Record<string, unknown> = {
      passed: report.passed,
      verdict: report.passed ? "satisfied" : report.finding!.kind,
      finding,
      system: {
        ...summarizeMachine(report.system),
        reachableStates: report.systemReachability.states.length,
        reachableTransitions: report.systemReachability.transitions.length,
      },
      property: report.property
        ? {
            name: report.property.definition.name,
            reachableProductStates: report.property.reachability.states.length,
            reachableProductTransitions: report.property.reachability.transitions.length,
          }
        : null,
      progress: report.progress
        ? {
            fairness: report.progress.fairness,
            terminalComponents: report.progress.terminalComponents.length,
            properties: report.progress.results.map((progressResult) => ({
              ...progressResult.property,
              satisfied: progressResult.satisfied,
              violation: progressResult.violation
                ? {
                    prefixTrace: progressResult.violation.prefixTrace,
                    terminalStates: progressResult.violation.terminalStates,
                    recurringActions: progressResult.violation.recurringActions,
                    missingProgressActions:
                      progressResult.violation.missingProgressActions,
                  }
                : null,
            })),
          }
        : null,
    };
    if (input.includeSystem) {
      result.composedSystem = report.system;
    }

    const message = report.passed
      ? `No deadlock, ERROR state, supplied safety-property violation, or fair-choice progress violation was found in ${report.systemReachability.states.length} explored system states.`
      : report.finding!.kind === "progress-violation"
        ? `${report.finding!.title} under fair-choice semantics. Shortest trace to the violating terminal component: ${report.finding!.trace.map((step) => step.action).join(" -> ") || "initial state"}.`
        : `${report.finding!.title}. Shortest counterexample: ${report.finding!.trace.map((step) => step.action).join(" -> ") || "initial state"}.`;
    return toolResult(message, result);
  });
}

export function renderLtsTool(input: RenderInput): Promise<CallToolResult> {
  return runSafely(async () => {
    const machines = parseMachines(input.machines);
    const system =
      machines.length === 1
        ? machines[0]!
        : composeStateMachines(machines, { maxStates: stateLimit(input) });
    const property = parseProperty(input.property);
    const machine = property
      ? monitorProperty(system, property, { maxStates: stateLimit(input) })
      : system;
    const trace = parseTrace(input.trace);
    const highlightStates = parseHighlightStates(input.highlightStates);
    const dot = buildMachineDot(machine, {
      background: "dark",
      highlightStates,
      orientation: input.orientation ?? "horizontal",
      trace,
    });
    const viz = await instance();
    const svg = viz.renderString(dot, { format: "svg", engine: "dot" });
    const slug = machine.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lts";
    const summary = summarizeMachine(machine);

    return toolResult(
      `Rendered ${machine.name} as an SVG state graph${trace.length ? ` with ${trace.length} counterexample steps highlighted` : ""}${highlightStates.length ? ` and ${highlightStates.length} recurrent states highlighted` : ""}.`,
      {
        rendered: true,
        summary,
        traceLength: trace.length,
        highlightedStates: highlightStates.length,
      },
      [
        {
          type: "resource",
          resource: {
            uri: `anvilts://graphs/${slug}.svg`,
            mimeType: "image/svg+xml",
            text: svg,
          },
          annotations: { audience: ["user", "assistant"], priority: 1 },
        },
      ],
    );
  });
}
