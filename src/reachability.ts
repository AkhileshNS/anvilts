import {
  ERROR_STATE,
  NO_END,
  stateKey,
  statesEqual,
  type State,
  type StateMachine,
  type Transition,
} from "./state-machine.ts";

export interface ReachabilityOptions<StateType extends State> {
  initial: StateType;
  eligibleTransitions: (state: StateType) => Transition<StateType>[];
  isEnd: (state: StateType) => boolean;
  isError?: (state: StateType) => boolean;
}

export interface Deadlock<StateType extends State = State> {
  state: StateType;
  trace: Transition<StateType>[];
}

export interface ReachabilityResult<StateType extends State = State> {
  states: StateType[];
  transitions: Transition<StateType>[];
  deadlocks: Deadlock<StateType>[];
  violations: Deadlock<StateType>[];
}

interface Parent<StateType extends State> {
  previous: StateType;
  action: string;
  current: StateType;
}

function buildTrace<StateType extends State>(
  state: StateType,
  parents: Map<string, Parent<StateType>>,
): Transition<StateType>[] {
  const trace: Transition<StateType>[] = [];
  let key = stateKey(state);

  while (parents.has(key)) {
    const parent = parents.get(key)!;
    trace.unshift({
      from: parent.previous,
      action: parent.action,
      to: parent.current,
    });
    key = stateKey(parent.previous);
  }

  return trace;
}

/**
 * Explores each reachable state exactly once using breadth-first search.
 * Parent links therefore reconstruct a shortest trace to every deadlock.
 */
export function exploreReachable<StateType extends State>(
  options: ReachabilityOptions<StateType>,
): ReachabilityResult<StateType> {
  const visited = new Set([stateKey(options.initial)]);
  const worklist: StateType[] = [options.initial];
  const parents = new Map<string, Parent<StateType>>();
  const transitions: Transition<StateType>[] = [];
  const deadlocks: Deadlock<StateType>[] = [];
  const violations: Deadlock<StateType>[] = [];

  for (let cursor = 0; cursor < worklist.length; cursor += 1) {
    const state = worklist[cursor]!;
    const isEnd = options.isEnd(state);
    const isError = options.isError?.(state) ?? false;

    if (isError) {
      violations.push({
        state,
        trace: buildTrace(state, parents),
      });
      continue;
    }

    const successors = isEnd ? [] : options.eligibleTransitions(state);

    if (successors.length === 0 && !isEnd) {
      deadlocks.push({
        state,
        trace: buildTrace(state, parents),
      });
      continue;
    }

    for (const transition of successors) {
      transitions.push(transition);
      const key = stateKey(transition.to);

      if (!visited.has(key)) {
        visited.add(key);
        parents.set(key, {
          previous: state,
          action: transition.action,
          current: transition.to,
        });
        worklist.push(transition.to);
      }
    }
  }

  return { states: worklist, transitions, deadlocks, violations };
}

export function detectDeadlocks<StateType extends State>(
  machine: StateMachine<StateType>,
): ReachabilityResult<StateType> {
  const outgoing = new Map<string, Transition<StateType>[]>();

  for (const transition of machine.transitions) {
    const key = stateKey(transition.from);
    const transitions = outgoing.get(key) ?? [];
    transitions.push(transition);
    outgoing.set(key, transitions);
  }

  return exploreReachable({
    initial: machine.initial,
    eligibleTransitions: (state) => outgoing.get(stateKey(state)) ?? [],
    isEnd: (state) =>
      machine.end !== NO_END && statesEqual(state, machine.end),
    isError: (state) => statesEqual(state, ERROR_STATE),
  });
}
