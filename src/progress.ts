import {
  TAU,
  stateKey,
  type State,
  type StateMachine,
  type Transition,
} from "./state-machine.ts";
import type { ReachabilityResult } from "./reachability.ts";

export interface BasicProgressProperty {
  name: string;
  type: "progress";
  actions: string[];
}

export interface ConditionalProgressProperty {
  name: string;
  type: "conditional-progress";
  conditionActions: string[];
  progressActions: string[];
}

export type ProgressProperty =
  | BasicProgressProperty
  | ConditionalProgressProperty;

export interface TerminalComponent<StateType extends State = State> {
  states: StateType[];
  transitions: Transition<StateType>[];
  actions: string[];
  prefixTrace: Transition<StateType>[];
}

export interface ProgressViolation<StateType extends State = State> {
  property: ProgressProperty;
  terminalStates: StateType[];
  recurringActions: string[];
  missingProgressActions: string[];
  prefixTrace: Transition<StateType>[];
}

export interface ProgressPropertyResult<StateType extends State = State> {
  property: ProgressProperty;
  satisfied: boolean;
  violation?: ProgressViolation<StateType>;
}

export interface ProgressAnalysis<StateType extends State = State> {
  fairness: "fair-choice";
  terminalComponents: TerminalComponent<StateType>[];
  results: ProgressPropertyResult<StateType>[];
  violations: ProgressViolation<StateType>[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseActionSet(
  value: unknown,
  field: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    !value.every(
      (action) => typeof action === "string" && action.trim().length > 0,
    )
  ) {
    throw new Error(`${field} must be a non-empty array of action names.`);
  }

  if (new Set(value).size !== value.length) {
    throw new Error(`${field} must not contain duplicate actions.`);
  }

  if (value.includes(TAU)) {
    throw new Error(`${field} must not include the internal action "tau".`);
  }

  return [...value];
}

export function parseProgressProperty(value: unknown): ProgressProperty {
  if (!isObject(value)) {
    throw new Error("A progress property must be a JSON object.");
  }

  if (typeof value.name !== "string" || value.name.trim().length === 0) {
    throw new Error('Progress property "name" must be a non-empty string.');
  }

  if (value.type === "progress") {
    return {
      name: value.name,
      type: value.type,
      actions: parseActionSet(value.actions, 'Progress property "actions"'),
    };
  }

  if (value.type === "conditional-progress") {
    return {
      name: value.name,
      type: value.type,
      conditionActions: parseActionSet(
        value.conditionActions,
        'Conditional progress property "conditionActions"',
      ),
      progressActions: parseActionSet(
        value.progressActions,
        'Conditional progress property "progressActions"',
      ),
    };
  }

  throw new Error(
    'Progress property "type" must be "progress" or "conditional-progress".',
  );
}

function propertyActions(property: ProgressProperty): string[] {
  return property.type === "progress"
    ? property.actions
    : [...property.conditionActions, ...property.progressActions];
}

export function validateProgressProperties(
  properties: ProgressProperty[],
  systemAlphabet: Iterable<string>,
): void {
  const alphabet = new Set(systemAlphabet);
  const names = new Set<string>();

  for (const property of properties) {
    if (names.has(property.name)) {
      throw new Error(
        `Progress property names must be unique; duplicate ${JSON.stringify(property.name)}.`,
      );
    }
    names.add(property.name);

    for (const action of propertyActions(property)) {
      if (!alphabet.has(action)) {
        throw new Error(
          `Progress property ${JSON.stringify(property.name)} action ` +
            `${JSON.stringify(action)} is not in the system alphabet.`,
        );
      }
    }
  }
}

interface Graph<StateType extends State> {
  stateByKey: Map<string, StateType>;
  outgoing: Map<string, Transition<StateType>[]>;
  incoming: Map<string, string[]>;
}

function buildGraph<StateType extends State>(
  reachability: ReachabilityResult<StateType>,
): Graph<StateType> {
  const stateByKey = new Map(
    reachability.states.map((state) => [stateKey(state), state]),
  );
  const outgoing = new Map<string, Transition<StateType>[]>();
  const incoming = new Map<string, string[]>();

  for (const key of stateByKey.keys()) {
    outgoing.set(key, []);
    incoming.set(key, []);
  }

  for (const transition of reachability.transitions) {
    const from = stateKey(transition.from);
    const to = stateKey(transition.to);
    outgoing.get(from)?.push(transition);
    incoming.get(to)?.push(from);
  }

  return { stateByKey, outgoing, incoming };
}

function finishOrder<StateType extends State>(graph: Graph<StateType>): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  for (const start of graph.stateByKey.keys()) {
    if (visited.has(start)) {
      continue;
    }

    visited.add(start);
    const stack: Array<{ key: string; next: number }> = [{ key: start, next: 0 }];

    while (stack.length > 0) {
      const frame = stack.at(-1)!;
      const transitions = graph.outgoing.get(frame.key) ?? [];

      if (frame.next < transitions.length) {
        const transition = transitions[frame.next]!;
        frame.next += 1;
        const next = stateKey(transition.to);
        if (!visited.has(next)) {
          visited.add(next);
          stack.push({ key: next, next: 0 });
        }
        continue;
      }

      order.push(frame.key);
      stack.pop();
    }
  }

  return order;
}

function stronglyConnectedComponents<StateType extends State>(
  graph: Graph<StateType>,
): string[][] {
  const assigned = new Set<string>();
  const components: string[][] = [];
  const order = finishOrder(graph);

  for (let index = order.length - 1; index >= 0; index -= 1) {
    const start = order[index]!;
    if (assigned.has(start)) {
      continue;
    }

    const component: string[] = [];
    const stack = [start];
    assigned.add(start);

    while (stack.length > 0) {
      const key = stack.pop()!;
      component.push(key);

      for (const previous of graph.incoming.get(key) ?? []) {
        if (!assigned.has(previous)) {
          assigned.add(previous);
          stack.push(previous);
        }
      }
    }

    components.push(component);
  }

  return components;
}

function shortestTraceTo<StateType extends State>(
  initial: StateType,
  targets: Set<string>,
  outgoing: Map<string, Transition<StateType>[]>,
): Transition<StateType>[] {
  const initialKey = stateKey(initial);
  if (targets.has(initialKey)) {
    return [];
  }

  const visited = new Set([initialKey]);
  const queue = [initialKey];
  const parents = new Map<
    string,
    { previous: string; transition: Transition<StateType> }
  >();
  let found: string | undefined;

  for (let cursor = 0; cursor < queue.length && found === undefined; cursor += 1) {
    const key = queue[cursor]!;
    for (const transition of outgoing.get(key) ?? []) {
      const next = stateKey(transition.to);
      if (visited.has(next)) {
        continue;
      }

      visited.add(next);
      parents.set(next, { previous: key, transition });
      if (targets.has(next)) {
        found = next;
        break;
      }
      queue.push(next);
    }
  }

  if (found === undefined) {
    throw new Error("Internal error: terminal component is not reachable.");
  }

  const trace: Transition<StateType>[] = [];
  let cursor = found;
  while (cursor !== initialKey) {
    const parent = parents.get(cursor)!;
    trace.unshift(parent.transition);
    cursor = parent.previous;
  }
  return trace;
}

function terminalComponents<StateType extends State>(
  machine: StateMachine<StateType>,
  reachability: ReachabilityResult<StateType>,
): TerminalComponent<StateType>[] {
  const graph = buildGraph(reachability);
  const terminal: TerminalComponent<StateType>[] = [];

  for (const componentKeys of stronglyConnectedComponents(graph)) {
    const keys = new Set(componentKeys);
    const transitions = componentKeys.flatMap(
      (key) => graph.outgoing.get(key) ?? [],
    );
    const hasOutgoing = transitions.some(
      (transition) => !keys.has(stateKey(transition.to)),
    );
    if (hasOutgoing) {
      continue;
    }

    const internalTransitions = transitions.filter((transition) =>
      keys.has(stateKey(transition.to)),
    );
    const supportsInfiniteExecution =
      componentKeys.length > 1 ||
      internalTransitions.some(
        (transition) => stateKey(transition.from) === stateKey(transition.to),
      );
    if (!supportsInfiniteExecution) {
      continue;
    }

    const states = componentKeys.map((key) => graph.stateByKey.get(key)!);
    terminal.push({
      states,
      transitions: internalTransitions,
      actions: [...new Set(internalTransitions.map((edge) => edge.action))].sort(),
      prefixTrace: shortestTraceTo(machine.initial, keys, graph.outgoing),
    });
  }

  return terminal.sort((left, right) => {
    const lengthDifference = left.prefixTrace.length - right.prefixTrace.length;
    if (lengthDifference !== 0) {
      return lengthDifference;
    }
    return stateKey(left.states[0]!).localeCompare(stateKey(right.states[0]!));
  });
}

function violationFor<StateType extends State>(
  property: ProgressProperty,
  component: TerminalComponent<StateType>,
): ProgressViolation<StateType> | undefined {
  const recurring = new Set(component.actions);
  const progressActions =
    property.type === "progress" ? property.actions : property.progressActions;
  const hasProgress = progressActions.some((action) => recurring.has(action));

  if (property.type === "conditional-progress") {
    const conditionOccurs = property.conditionActions.some((action) =>
      recurring.has(action),
    );
    if (!conditionOccurs || hasProgress) {
      return undefined;
    }
  } else if (hasProgress) {
    return undefined;
  }

  return {
    property,
    terminalStates: component.states,
    recurringActions: component.actions,
    missingProgressActions: [...progressActions],
    prefixTrace: component.prefixTrace,
  };
}

export function analyzeProgress<StateType extends State>(
  machine: StateMachine<StateType>,
  reachability: ReachabilityResult<StateType>,
  properties: ProgressProperty[],
): ProgressAnalysis<StateType> {
  validateProgressProperties(properties, machine.alphabet);
  const components = terminalComponents(machine, reachability);
  const results = properties.map((property) => {
    const violation = components
      .map((component) => violationFor(property, component))
      .find((candidate) => candidate !== undefined);
    return {
      property,
      satisfied: violation === undefined,
      ...(violation ? { violation } : {}),
    };
  });

  return {
    fairness: "fair-choice",
    terminalComponents: components,
    results,
    violations: results.flatMap((result) =>
      result.violation ? [result.violation] : [],
    ),
  };
}
