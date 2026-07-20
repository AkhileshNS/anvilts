import type { State, StateMachine, Transition } from "./state-machine.ts";

export type CompositeState = State[];

function stateKey(state: State): string {
  return JSON.stringify(state);
}

function statesEqual(left: State, right: State): boolean {
  return stateKey(left) === stateKey(right);
}

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
): StateMachine<CompositeState> {
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

  const initial = machines.map((machine) => machine.initial);
  const discovered = new Set([stateKey(initial)]);
  const pending: CompositeState[] = [initial];
  const transitions: Transition<CompositeState>[] = [];

  for (let cursor = 0; cursor < pending.length; cursor += 1) {
    const compositeState = pending[cursor];

    if (compositeState === undefined) {
      continue;
    }

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
        transitions.push({
          from: [...compositeState],
          action,
          to: target,
        });

        const key = stateKey(target);

        if (!discovered.has(key)) {
          discovered.add(key);
          pending.push(target);
        }
      }
    }
  }

  return {
    name: machines.map((machine) => machine.name).join(" || "),
    alphabet,
    initial,
    transitions,
  };
}
