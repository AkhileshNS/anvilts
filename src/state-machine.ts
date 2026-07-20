export type State = number | State[];

export interface Transition<StateType extends State = State> {
  from: StateType;
  action: string;
  to: StateType;
}

export interface StateMachine<StateType extends State = State> {
  name: string;
  alphabet: string[];
  initial: StateType;
  transitions: Transition<StateType>[];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isState(value: unknown): value is State {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0;
  }

  return Array.isArray(value) && value.length > 0 && value.every(isState);
}

/**
 * Validates untrusted JSON and returns it as a state machine.
 */
export function parseStateMachine(value: unknown): StateMachine {
  if (!isObject(value)) {
    throw new Error("The state machine must be a JSON object.");
  }

  if (typeof value.name !== "string" || value.name.trim() === "") {
    throw new Error('"name" must be a non-empty string.');
  }

  if (
    !Array.isArray(value.alphabet) ||
    !value.alphabet.every(
      (action) => typeof action === "string" && action.trim() !== "",
    )
  ) {
    throw new Error('"alphabet" must be an array of non-empty strings.');
  }

  if (new Set(value.alphabet).size !== value.alphabet.length) {
    throw new Error('"alphabet" must not contain duplicate actions.');
  }

  if (!isState(value.initial)) {
    throw new Error(
      '"initial" must be a non-negative integer or a non-empty tuple of states.',
    );
  }

  if (!Array.isArray(value.transitions)) {
    throw new Error('"transitions" must be an array.');
  }

  const alphabet = new Set(value.alphabet);
  const transitions: Transition[] = [];

  for (const [index, candidate] of value.transitions.entries()) {
    if (!isObject(candidate)) {
      throw new Error(`Transition ${index} must be an object.`);
    }

    if (!isState(candidate.from)) {
      throw new Error(
        `Transition ${index} field "from" must be a non-negative integer ` +
          "or a non-empty tuple of states.",
      );
    }

    if (
      typeof candidate.action !== "string" ||
      candidate.action.trim() === ""
    ) {
      throw new Error(
        `Transition ${index} field "action" must be a non-empty string.`,
      );
    }

    if (!alphabet.has(candidate.action)) {
      throw new Error(
        `Transition ${index} action ${JSON.stringify(candidate.action)} is not ` +
          "in the alphabet.",
      );
    }

    if (!isState(candidate.to)) {
      throw new Error(
        `Transition ${index} field "to" must be a non-negative integer ` +
          "or a non-empty tuple of states.",
      );
    }

    transitions.push({
      from: candidate.from,
      action: candidate.action,
      to: candidate.to,
    });
  }

  return {
    name: value.name,
    alphabet: [...value.alphabet],
    initial: value.initial,
    transitions,
  };
}

/**
 * Core entry point for interfaces that receive a JSON representation.
 * A CLI can supply file contents; a web frontend can supply text from an
 * upload, editor, or API response.
 */
export function parseStateMachineJson(contents: string): StateMachine {
  let value: unknown;

  try {
    value = JSON.parse(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON: ${message}`);
  }

  return parseStateMachine(value);
}
