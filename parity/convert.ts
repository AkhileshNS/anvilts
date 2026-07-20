import {
  ERROR_STATE,
  NO_END,
  type State,
  type StateMachine,
  type Transition,
} from "../src/state-machine.ts";

/**
 * Shape of a single machine inside the JSON emitted by ltsp.jar's `-go` flag.
 *
 * A transition value is either a bare target ("s1") or, for a nondeterministic
 * action, an object listing several targets ({"target": ["s1", "s2"]}). Action
 * keys may be "set labels" such as "{phil.0.left.get,phil.4.right.get}" that
 * LTSA uses for shared/relabelled actions.
 */
export interface LtspTransitionTarget {
  target: string[];
}

export interface LtspMachine {
  key: string;
  initial: string;
  states: Record<string, { on?: Record<string, string | LtspTransitionTarget> }>;
}

export interface LtspGraph {
  machines: LtspMachine[];
}

function parseStateId(key: string): number {
  const match = /^s(\d+)$/.exec(key.trim());

  if (match === null) {
    throw new Error(`Unexpected LTSA state id ${JSON.stringify(key)}.`);
  }

  return Number(match[1]);
}

/**
 * Maps an LTSA target label to an engine state. The tool renders its ERROR sink
 * (state id -1, reached on a safety violation) as the literal target
 * `"tau(-1)"`; everything else is a normal `sN` state.
 */
function mapTarget(target: string): State {
  const trimmed = target.trim();

  if (trimmed === "tau(-1)") {
    return ERROR_STATE;
  }

  if (/^tau\(/.test(trimmed)) {
    throw new Error(`Unexpected tau target ${JSON.stringify(target)}.`);
  }

  return parseStateId(trimmed);
}

/**
 * Expands an LTSA action key into the individual action names our engine
 * synchronizes on. A shared "set label" like "{a,b}" becomes ["a", "b"], each
 * of which is emitted as its own transition so that exact-name multiway
 * handshake reproduces LTSA's shared-action semantics.
 */
function expandActionLabel(action: string): string[] {
  const trimmed = action.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0);
  }

  return [trimmed];
}

function targetsOf(value: string | LtspTransitionTarget): string[] {
  return typeof value === "string" ? [value] : value.target;
}

/**
 * Converts one ltsp.jar machine into the AnviLTS engine schema.
 *
 * State ids are taken directly from LTSA's "sN" labels so ids line up with the
 * `initial` field and with LTSA's own numbering. `end` is always NO_END: the
 * jar renders both STOP (a deadlock) and END (legitimate termination) as an
 * empty `on` map, so END-bearing models are excluded upstream and every
 * terminal state is treated as a genuine deadlock here.
 */
export function convertMachine(machine: LtspMachine): StateMachine {
  const transitions: Transition[] = [];
  const alphabet = new Set<string>();

  for (const [stateKey, definition] of Object.entries(machine.states)) {
    const from = parseStateId(stateKey);
    const on = definition.on ?? {};

    for (const [actionKey, value] of Object.entries(on)) {
      const actions = expandActionLabel(actionKey);
      const targets = targetsOf(value).map(mapTarget);

      for (const action of actions) {
        alphabet.add(action);

        for (const to of targets) {
          transitions.push({ from, action, to });
        }
      }
    }
  }

  return {
    name: machine.key,
    alphabet: [...alphabet],
    initial: parseStateId(machine.initial),
    end: NO_END,
    transitions,
  };
}

/**
 * Converts an LTSA property machine into the *authored* safety monitor the
 * engine expects: transitions to ERROR (the tool's completion of illegal
 * actions) are dropped so that the engine's own `completeProperty` re-derives
 * them. The alphabet is kept from the full machine so watched actions whose only
 * transition was to ERROR are still monitored.
 */
export function convertProperty(machine: LtspMachine): StateMachine {
  const full = convertMachine(machine);

  return {
    ...full,
    transitions: full.transitions.filter((transition) => transition.to !== ERROR_STATE),
  };
}

/**
 * Splits a composed graph into its component operands and the final composite.
 * The composite is the machine whose key matches the requested process name;
 * ltsp.jar emits it last, so we fall back to the final entry if the name does
 * not match exactly.
 */
export function splitComposedGraph(
  graph: LtspGraph,
  processName: string,
): { components: LtspMachine[]; composite: LtspMachine | undefined } {
  if (graph.machines.length === 0) {
    return { components: [], composite: undefined };
  }

  const composite =
    graph.machines.find((machine) => machine.key === processName) ??
    graph.machines[graph.machines.length - 1];

  const components = graph.machines.filter((machine) => machine !== composite);

  return { components, composite };
}
