export const NO_END = -1;
export const END_STATE = "END";
export const ERROR_STATE = "ERROR";
export const TAU = "tau";

export type State =
  | number
  | typeof END_STATE
  | typeof ERROR_STATE
  | State[];

export interface CodeEvidence {
  kind: "code";
  /** Repository-relative path so an approved model remains portable. */
  path: string;
  startLine: number;
  endLine?: number;
  symbol?: string;
  explanation: string;
}

export interface NarrativeEvidence {
  kind: "user-stated" | "assumption" | "environment" | "derived";
  explanation: string;
}

export type TransitionEvidence = CodeEvidence | NarrativeEvidence;

export interface AbstractionMetadata {
  sourceRevision?: string;
  assumptions: string[];
  omissions: string[];
  unresolved: string[];
}

export interface Transition<StateType extends State = State> {
  from: StateType;
  action: string;
  to: StateType;
  evidence?: TransitionEvidence[];
}

export interface StateMachine<StateType extends State = State> {
  name: string;
  alphabet: string[];
  initial: StateType;
  end: StateType | typeof NO_END;
  transitions: Transition<StateType>[];
  abstraction?: AbstractionMetadata;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function parseStringList(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    !value.every(nonEmptyString)
  ) {
    throw new Error(`${field} must be an array of non-empty strings.`);
  }

  if (new Set(value).size !== value.length) {
    throw new Error(`${field} must not contain duplicate entries.`);
  }

  return [...value];
}

function parseTransitionEvidence(
  value: unknown,
  transitionIndex: number,
  evidenceIndex: number,
): TransitionEvidence {
  const field = `Transition ${transitionIndex} evidence ${evidenceIndex}`;

  if (!isObject(value)) {
    throw new Error(`${field} must be an object.`);
  }

  if (!nonEmptyString(value.explanation)) {
    throw new Error(`${field} field "explanation" must be a non-empty string.`);
  }

  if (value.kind === "code") {
    if (!nonEmptyString(value.path)) {
      throw new Error(`${field} field "path" must be a non-empty string.`);
    }

    const normalizedPath = value.path.replaceAll("\\", "/");

    if (
      /^(?:[A-Za-z]:|\/)/.test(normalizedPath) ||
      normalizedPath.split("/").includes("..")
    ) {
      throw new Error(
        `${field} field "path" must be relative to the source repository.`,
      );
    }

    if (!Number.isInteger(value.startLine) || Number(value.startLine) < 1) {
      throw new Error(`${field} field "startLine" must be a positive integer.`);
    }

    if (
      value.endLine !== undefined &&
      (!Number.isInteger(value.endLine) ||
        Number(value.endLine) < Number(value.startLine))
    ) {
      throw new Error(
        `${field} field "endLine" must be an integer at or after "startLine".`,
      );
    }

    if (value.symbol !== undefined && !nonEmptyString(value.symbol)) {
      throw new Error(`${field} field "symbol" must be a non-empty string.`);
    }

    return {
      kind: "code",
      path: normalizedPath,
      startLine: Number(value.startLine),
      ...(value.endLine === undefined
        ? {}
        : { endLine: Number(value.endLine) }),
      ...(value.symbol === undefined ? {} : { symbol: value.symbol }),
      explanation: value.explanation,
    };
  }

  if (
    value.kind !== "user-stated" &&
    value.kind !== "assumption" &&
    value.kind !== "environment" &&
    value.kind !== "derived"
  ) {
    throw new Error(
      `${field} field "kind" must be "code", "user-stated", ` +
        '"assumption", "environment", or "derived".',
    );
  }

  return {
    kind: value.kind,
    explanation: value.explanation,
  };
}

export function mergeEvidence(
  ...evidenceSets: Array<TransitionEvidence[] | undefined>
): TransitionEvidence[] | undefined {
  const merged: TransitionEvidence[] = [];
  const seen = new Set<string>();

  for (const evidence of evidenceSets.flatMap((set) => set ?? [])) {
    const key = JSON.stringify(evidence);

    if (!seen.has(key)) {
      seen.add(key);
      merged.push(evidence);
    }
  }

  return merged.length === 0 ? undefined : merged;
}

export function mergeAbstractions(
  machines: StateMachine[],
): AbstractionMetadata | undefined {
  const abstractions = machines.flatMap((machine) =>
    machine.abstraction === undefined ? [] : [machine.abstraction],
  );

  if (abstractions.length === 0) {
    return undefined;
  }

  const revisions = [
    ...new Set(
      abstractions.flatMap((abstraction) =>
        abstraction.sourceRevision === undefined
          ? []
          : [abstraction.sourceRevision],
      ),
    ),
  ];
  const mergeList = (select: (value: AbstractionMetadata) => string[]) => [
    ...new Set(abstractions.flatMap(select)),
  ];
  const unresolved = mergeList((abstraction) => abstraction.unresolved);

  if (revisions.length > 1) {
    unresolved.push(
      `Component models reference multiple source revisions: ${revisions.join(", ")}.`,
    );
  }

  return {
    ...(revisions.length === 1 ? { sourceRevision: revisions[0] } : {}),
    assumptions: mergeList((abstraction) => abstraction.assumptions),
    omissions: mergeList((abstraction) => abstraction.omissions),
    unresolved: [...new Set(unresolved)],
  };
}

export function isState(value: unknown): value is State {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 0;
  }

  if (value === END_STATE || value === ERROR_STATE) {
    return true;
  }

  return Array.isArray(value) && value.length > 0 && value.every(isState);
}

export function stateKey(state: State): string {
  return JSON.stringify(state);
}

export function statesEqual(left: State, right: State): boolean {
  return stateKey(left) === stateKey(right);
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

  const end = value.end ?? NO_END;

  if (end !== NO_END && (end === ERROR_STATE || !isState(end))) {
    throw new Error(
      '"end" must be -1, a state, or the reserved composite state "END".',
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

    let evidence: TransitionEvidence[] | undefined;

    if (candidate.evidence !== undefined) {
      if (!Array.isArray(candidate.evidence) || candidate.evidence.length === 0) {
        throw new Error(
          `Transition ${index} field "evidence" must be a non-empty array.`,
        );
      }

      evidence = candidate.evidence.map((item, evidenceIndex) =>
        parseTransitionEvidence(item, index, evidenceIndex),
      );

      if (mergeEvidence(evidence)?.length !== evidence.length) {
        throw new Error(`Transition ${index} evidence must not contain duplicates.`);
      }
    }

    transitions.push({
      from: candidate.from,
      action: candidate.action,
      to: candidate.to,
      ...(evidence === undefined ? {} : { evidence }),
    });
  }

  let abstraction: AbstractionMetadata | undefined;

  if (value.abstraction !== undefined) {
    if (!isObject(value.abstraction)) {
      throw new Error('"abstraction" must be an object.');
    }

    if (
      value.abstraction.sourceRevision !== undefined &&
      !nonEmptyString(value.abstraction.sourceRevision)
    ) {
      throw new Error(
        '"abstraction.sourceRevision" must be a non-empty string.',
      );
    }

    abstraction = {
      ...(value.abstraction.sourceRevision === undefined
        ? {}
        : { sourceRevision: value.abstraction.sourceRevision }),
      assumptions: parseStringList(
        value.abstraction.assumptions ?? [],
        '"abstraction.assumptions"',
      ),
      omissions: parseStringList(
        value.abstraction.omissions ?? [],
        '"abstraction.omissions"',
      ),
      unresolved: parseStringList(
        value.abstraction.unresolved ?? [],
        '"abstraction.unresolved"',
      ),
    };
  }

  return {
    name: value.name,
    alphabet: [...value.alphabet],
    initial: value.initial,
    end,
    transitions,
    ...(abstraction === undefined ? {} : { abstraction }),
  };
}

/**
 * Core entry point for interfaces that receive a JSON representation.
 * A CLI can supply file contents; an MCP or API caller can supply serialized
 * model data.
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
