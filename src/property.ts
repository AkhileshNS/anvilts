import { exploreReachable } from "./reachability.ts";
import {
  END_STATE,
  ERROR_STATE,
  NO_END,
  TAU,
  stateKey,
  statesEqual,
  type State,
  type StateMachine,
  type Transition,
} from "./state-machine.ts";

export type MonitoredState =
  | [system: State, property: State]
  | typeof END_STATE
  | typeof ERROR_STATE;

/**
 * Makes a safety-property monitor total and deterministic over every relevant
 * action. Missing transitions are violations and therefore lead to ERROR.
 */
export function completeProperty(property: StateMachine): StateMachine {
  if (property.end !== NO_END) {
    throw new Error("A safety property must be non-terminating.");
  }

  if (property.transitions.some((transition) => transition.action === TAU)) {
    throw new Error("A safety property cannot observe internal tau actions.");
  }

  const relevantActions = property.alphabet.filter((action) => action !== TAU);
  const states = new Map<string, State>();

  states.set(stateKey(property.initial), property.initial);

  for (const transition of property.transitions) {
    states.set(stateKey(transition.from), transition.from);
    states.set(stateKey(transition.to), transition.to);
  }

  states.set(stateKey(ERROR_STATE), ERROR_STATE);

  const transitions = property.transitions.map((transition) => ({
    ...transition,
  }));

  for (const state of states.values()) {
    for (const action of relevantActions) {
      const matching = transitions.filter(
        (transition) =>
          statesEqual(transition.from, state) && transition.action === action,
      );

      if (matching.length > 1) {
        throw new Error(
          `Property ${JSON.stringify(property.name)} is nondeterministic at ` +
            `${stateKey(state)} for action ${JSON.stringify(action)}.`,
        );
      }

      if (state === ERROR_STATE) {
        if (
          matching.length === 1 &&
          !statesEqual(matching[0]!.to, ERROR_STATE)
        ) {
          throw new Error("Transitions from ERROR must return to ERROR.");
        }

        if (matching.length === 0) {
          transitions.push({ from: ERROR_STATE, action, to: ERROR_STATE });
        }

        continue;
      }

      if (matching.length === 0) {
        transitions.push({ from: state, action, to: ERROR_STATE });
      }
    }
  }

  return {
    ...property,
    transitions,
  };
}

/**
 * Builds the reachable product of a system and a passive safety monitor.
 * Only system transitions drive the product; the property can never invent or
 * block behavior.
 */
export function monitorProperty(
  system: StateMachine,
  propertyDefinition: StateMachine,
): StateMachine<MonitoredState> {
  const property = completeProperty(propertyDefinition);
  const relevantActions = new Set(
    property.alphabet.filter((action) => action !== TAU),
  );

  for (const action of relevantActions) {
    if (!system.alphabet.includes(action)) {
      throw new Error(
        `Property action ${JSON.stringify(action)} is not in the system alphabet.`,
      );
    }
  }

  const systemOutgoing = new Map<string, Transition[]>();
  const propertyOutgoing = new Map<string, Transition[]>();

  for (const transition of system.transitions) {
    const key = stateKey(transition.from);
    const outgoing = systemOutgoing.get(key) ?? [];
    outgoing.push(transition);
    systemOutgoing.set(key, outgoing);
  }

  for (const transition of property.transitions) {
    const key = `${stateKey(transition.from)}\u0000${transition.action}`;
    const outgoing = propertyOutgoing.get(key) ?? [];
    outgoing.push(transition);
    propertyOutgoing.set(key, outgoing);
  }

  function normalizeTarget(systemState: State, propertyState: State): MonitoredState {
    if (
      statesEqual(systemState, ERROR_STATE) ||
      statesEqual(propertyState, ERROR_STATE)
    ) {
      return ERROR_STATE;
    }

    if (system.end !== NO_END && statesEqual(systemState, system.end)) {
      return END_STATE;
    }

    return [systemState, propertyState];
  }

  function eligibleTransitions(
    state: MonitoredState,
  ): Transition<MonitoredState>[] {
    if (state === END_STATE || state === ERROR_STATE) {
      return [];
    }

    const [systemState, propertyState] = state;

    return (systemOutgoing.get(stateKey(systemState)) ?? []).map(
      (systemTransition) => {
        let nextPropertyState = propertyState;

        if (
          systemTransition.action !== TAU &&
          relevantActions.has(systemTransition.action)
        ) {
          const key =
            `${stateKey(propertyState)}\u0000${systemTransition.action}`;
          const matching = propertyOutgoing.get(key) ?? [];

          if (matching.length !== 1) {
            throw new Error(
              `Completed property expected one transition from ` +
                `${stateKey(propertyState)} for action ` +
                `${JSON.stringify(systemTransition.action)}.`,
            );
          }

          nextPropertyState = matching[0]!.to;
        }

        return {
          from: state,
          action: systemTransition.action,
          to: normalizeTarget(systemTransition.to, nextPropertyState),
        };
      },
    );
  }

  const initial = normalizeTarget(system.initial, property.initial);
  const result = exploreReachable({
    initial,
    eligibleTransitions,
    isEnd: (state) => state === END_STATE,
    isError: (state) => state === ERROR_STATE,
  });

  return {
    name: `${system.name} monitored by ${property.name}`,
    alphabet: [...system.alphabet],
    initial,
    end: system.end === NO_END ? NO_END : END_STATE,
    transitions: result.transitions,
  };
}
