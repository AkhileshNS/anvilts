import {
  ERROR_STATE,
  NO_END,
  stateKey,
  statesEqual,
  type State,
  type StateMachine,
  type Transition,
} from "./state-machine.ts";

export type GraphOrientation = "horizontal" | "vertical";

export interface MachineDotOptions {
  background?: "dark" | "transparent";
  current?: State;
  highlightStates?: State[];
  orientation?: GraphOrientation;
  trace?: Transition[];
}

export function displayState(state: State): string {
  if (Array.isArray(state)) {
    return `(${state.map(displayState).join(", ")})`;
  }

  return String(state);
}

function escapeDot(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function collectStates(machine: StateMachine): State[] {
  const states = new Map<string, State>();
  const add = (state: State) => states.set(stateKey(state), state);

  add(machine.initial);
  if (machine.end !== NO_END) {
    add(machine.end);
  }
  for (const transition of machine.transitions) {
    add(transition.from);
    add(transition.to);
  }

  return [...states.values()];
}

function transitionKey(transition: Transition): string {
  return `${stateKey(transition.from)}\u0000${transition.action}\u0000${stateKey(transition.to)}`;
}

function evidenceTooltip(transition: Transition): string | undefined {
  if (!transition.evidence?.length) {
    return undefined;
  }

  return transition.evidence
    .map((evidence) => {
      if (evidence.kind !== "code") {
        return `${evidence.kind}: ${evidence.explanation}`;
      }

      const lines =
        evidence.endLine === undefined || evidence.endLine === evidence.startLine
          ? `${evidence.startLine}`
          : `${evidence.startLine}-${evidence.endLine}`;
      const symbol = evidence.symbol ? ` (${evidence.symbol})` : "";
      return `${evidence.path}:${lines}${symbol} — ${evidence.explanation}`;
    })
    .join("\n");
}

export function buildMachineDot(
  machine: StateMachine,
  options: MachineDotOptions = {},
): string {
  const orientation = options.orientation ?? "horizontal";
  const current = options.current ?? options.trace?.at(-1)?.to ?? machine.initial;
  const traceStates = new Set(
    (options.trace ?? []).flatMap((transition) => [
      stateKey(transition.from),
      stateKey(transition.to),
    ]),
  );
  const traceTransitions = new Set((options.trace ?? []).map(transitionKey));
  const highlightedStates = new Set(
    (options.highlightStates ?? []).map(stateKey),
  );
  const states = collectStates(machine);
  const nodeIdByState = new Map(
    states.map((state, index) => [stateKey(state), `state_${index}`]),
  );
  const nodes = states.map((state, index) => {
    const isCurrent = statesEqual(state, current);
    const isEnd = machine.end !== NO_END && statesEqual(state, machine.end);
    const isError = statesEqual(state, ERROR_STATE);
    const isInTrace = traceStates.has(stateKey(state));
    const isHighlighted = highlightedStates.has(stateKey(state));
    const color = isError
      ? "#ff8585"
      : isCurrent
        ? "#f4f5f4"
        : isInTrace
          ? "#f0b35a"
          : isHighlighted
            ? "#a78bfa"
            : "#626262";
    const fill = isError
      ? "#321b1b"
      : isCurrent
        ? "#f4f5f4"
        : isInTrace
          ? "#2a2116"
          : isHighlighted
            ? "#211a36"
            : "#151515";
    const font = isCurrent ? "#101010" : isError ? "#ffb8b8" : "#dedede";
    const attributes = [
      `id="state-${index}"`,
      `label="${escapeDot(displayState(state))}"`,
      `shape="${isError ? "diamond" : isEnd ? "doublecircle" : "circle"}"`,
      `class="state-node${isCurrent ? " current-state" : ""}${isInTrace ? " trace-state" : ""}${isHighlighted ? " highlighted-state" : ""}"`,
      `color="${color}"`,
      `fillcolor="${fill}"`,
      `fontcolor="${font}"`,
      `penwidth="${isCurrent || isInTrace || isHighlighted ? "2.4" : "1.3"}"`,
    ];
    return `${nodeIdByState.get(stateKey(state))} [${attributes.join(", ")}];`;
  });
  const edges = machine.transitions.map((transition, index) => {
    const enabled = statesEqual(transition.from, current);
    const isInTrace = traceTransitions.has(transitionKey(transition));
    const isHighlighted =
      highlightedStates.has(stateKey(transition.from)) &&
      highlightedStates.has(stateKey(transition.to));
    const color = isInTrace
      ? "#f0b35a"
      : enabled
        ? "#f4f5f4"
        : isHighlighted
          ? "#a78bfa"
          : "#4a4a4a";
    const font = isInTrace
      ? "#ffd18d"
      : enabled
        ? "#f4f5f4"
        : isHighlighted
          ? "#c4b5fd"
          : "#888888";
    const attributes = [
      `id="transition-${index}"`,
      `label="${escapeDot(transition.action)}"`,
      `class="transition-edge${enabled ? " enabled-transition" : ""}${isInTrace ? " trace-transition" : ""}${isHighlighted ? " highlighted-transition" : ""}"`,
      `color="${color}"`,
      `fontcolor="${font}"`,
      `penwidth="${isInTrace || enabled || isHighlighted ? "2.4" : "1.1"}"`,
    ];
    const tooltip = evidenceTooltip(transition);

    if (tooltip !== undefined) {
      attributes.push(`tooltip="${escapeDot(tooltip)}"`);
    }

    return `${nodeIdByState.get(stateKey(transition.from))} -> ${nodeIdByState.get(
      stateKey(transition.to),
    )} [${attributes.join(", ")}];`;
  });
  const background = options.background === "dark" ? "#0d0d0d" : "transparent";

  return `digraph LTS {
    graph [bgcolor="${background}", rankdir="${orientation === "horizontal" ? "LR" : "TB"}", pad="0.3", nodesep="0.65", ranksep="0.8", splines="spline"];
    node [style="filled", fontname="Arial", fontsize="11", fixedsize="false", margin="0.12,0.08"];
    edge [fontname="Arial", fontsize="9", arrowsize="0.72"];
    __start [shape="point", width="0.08", color="#8a8a8a", fillcolor="#8a8a8a"];
    __start -> ${nodeIdByState.get(stateKey(machine.initial))} [color="#8a8a8a", arrowsize="0.65"];
    ${nodes.join("\n")}
    ${edges.join("\n")}
  }`;
}
