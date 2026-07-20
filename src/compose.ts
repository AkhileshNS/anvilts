import { exploreReachable } from "./reachability.ts";
import {
  END_STATE,
  NO_END,
  statesEqual,
  type State,
  type StateMachine,
  type Transition,
} from "./state-machine.ts";

export type CompositeState = State[];
export type CompositeMachineState = CompositeState | typeof END_STATE;

function enabledTransitions(
  machine: StateMachine,
  state: State,
  action: string,
): Transition[] {
  return machine.transitions.filter(
    (transition) =>
      statesEqual(transition.from, state) && transition.action === action,
  );
}

/**
 * Composes component LTSes by interleaving private actions and synchronizing
 * actions shared by component alphabets.
 */
export function composeStateMachines(
  machines: StateMachine[],
): StateMachine<CompositeMachineState> {
  if (machines.length < 2) {
    throw new Error("Composition requires at least two state machines.");
  }

  const names = new Set(machines.map((machine) => machine.name));

  if (names.size !== machines.length) {
    throw new Error("State machine names must be unique during composition.");
  }

  const alphabet = [
    ...new Set(machines.flatMap((machine) => machine.alphabet)),
  ];
  const participants = new Map<string, number[]>();

  for (const action of alphabet) {
    participants.set(
      action,
      machines.flatMap((machine, index) =>
        machine.alphabet.includes(action) ? [index] : [],
      ),
    );
  }

  const terminatingMachineIndexes = machines.flatMap((machine, index) =>
    machine.end !== NO_END ? [index] : [],
  );
  const terminatingAlphabet = new Set(
    terminatingMachineIndexes.flatMap((index) => machines[index]!.alphabet),
  );
  const canTerminate =
    terminatingMachineIndexes.length > 0 &&
    machines.every(
      (machine) =>
        machine.end !== NO_END ||
        machine.alphabet.every((action) => terminatingAlphabet.has(action)),
    );

  function isCompositeEnd(state: CompositeState): boolean {
    return (
      canTerminate &&
      terminatingMachineIndexes.every((index) =>
        statesEqual(state[index]!, machines[index]!.end),
      )
    );
  }

  function eligibleTransitions(
    compositeState: CompositeMachineState,
  ): Transition<CompositeMachineState>[] {
    if (compositeState === END_STATE) {
      return [];
    }

    const eligible: Transition<CompositeMachineState>[] = [];

    for (const action of alphabet) {
      const participatingMachines = participants.get(action) ?? [];
      const enabledByParticipant = participatingMachines.map((index) =>
        enabledTransitions(machines[index]!, compositeState[index]!, action),
      );

      if (
        enabledByParticipant.length === 0 ||
        enabledByParticipant.some((enabled) => enabled.length === 0)
      ) {
        continue;
      }

      let targets: CompositeState[] = [[...compositeState]];

      for (
        let participant = 0;
        participant < participatingMachines.length;
        participant += 1
      ) {
        const machineIndex = participatingMachines[participant]!;
        const enabled = enabledByParticipant[participant]!;
        const nextTargets: CompositeState[] = [];

        for (const target of targets) {
          for (const transition of enabled) {
            const nextTarget = [...target];
            nextTarget[machineIndex] = transition.to;
            nextTargets.push(nextTarget);
          }
        }

        targets = nextTargets;
      }

      for (const target of targets) {
        eligible.push({
          from: [...compositeState],
          action,
          to: isCompositeEnd(target) ? END_STATE : target,
        });
      }
    }

    return eligible;
  }

  const componentInitialState = machines.map((machine) => machine.initial);
  const initial: CompositeMachineState = isCompositeEnd(componentInitialState)
    ? END_STATE
    : componentInitialState;
  const result = exploreReachable({
    initial,
    eligibleTransitions,
    isEnd: (state) => state === END_STATE,
  });

  return {
    name: machines.map((machine) => machine.name).join(" || "),
    alphabet,
    initial,
    end: canTerminate ? END_STATE : NO_END,
    transitions: result.transitions,
  };
}
