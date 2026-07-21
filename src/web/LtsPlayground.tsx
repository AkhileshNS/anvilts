import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownRight,
  CornerDownLeft,
  Maximize2,
  RefreshCcw,
  RotateCw,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { instance, type Viz } from "@viz-js/viz";

import type { DemoProject } from "../examples/demo-projects";
import { createSystemSketch } from "../sketch/system-sketch";
import {
  buildMachineDot,
  displayState,
  type GraphOrientation as Orientation,
} from "../render";
import {
  ERROR_STATE,
  NO_END,
  stateKey,
  statesEqual,
  type State,
  type StateMachine,
  type Transition,
} from "../state-machine";

interface TraceStep {
  transitionIndex: number;
  from: State;
  action: string;
  to: State;
}

interface MachineSession {
  current: State;
  trace: TraceStep[];
}

interface MachineChoice {
  id: string;
  label: string;
  machine: StateMachine;
  property: boolean;
}

interface LtsPlaygroundProps {
  project: DemoProject;
  variantId: string;
}

interface ViewBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ViewportState {
  key: string;
  view: ViewBox;
  fit: ViewBox;
}

let vizPromise: Promise<Viz> | undefined;

function getViz(): Promise<Viz> {
  vizPromise ??= instance();
  return vizPromise;
}

function readViewBox(svg: SVGSVGElement): ViewBox | undefined {
  const values = svg
    .getAttribute("viewBox")
    ?.trim()
    .split(/\s+/)
    .map(Number);

  if (
    !values ||
    values.length !== 4 ||
    values.some((value) => !Number.isFinite(value)) ||
    values[2] <= 0 ||
    values[3] <= 0
  ) {
    return undefined;
  }

  return {
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
  };
}

function fitViewBox(
  graph: ViewBox,
  viewportWidth: number,
  viewportHeight: number,
): ViewBox {
  const maximumInitialScale = 1.1;
  const viewportAspect = viewportWidth / viewportHeight;
  let width = Math.max(graph.width, viewportWidth / maximumInitialScale);
  let height = Math.max(graph.height, viewportHeight / maximumInitialScale);

  if (width / height > viewportAspect) {
    height = width / viewportAspect;
  } else {
    width = height * viewportAspect;
  }

  return {
    x: graph.x + (graph.width - width) / 2,
    y: graph.y + (graph.height - height) / 2,
    width,
    height,
  };
}

function writeViewBox(svg: SVGSVGElement, view: ViewBox) {
  svg.setAttribute(
    "viewBox",
    `${view.x} ${view.y} ${view.width} ${view.height}`,
  );
}

function GraphvizMachine({
  machine,
  current,
  orientation,
  onTransition,
}: {
  machine: StateMachine;
  current: State;
  orientation: Orientation;
  onTransition: (transition: Transition, index: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const viewportRef = useRef<ViewportState>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const viewportKey = `${machine.name}:${orientation}`;

  const applyView = useCallback((view: ViewBox) => {
    const svg = svgRef.current;
    const viewport = viewportRef.current;
    if (!svg || !viewport) {
      return;
    }

    writeViewBox(svg, view);
    viewportRef.current = { ...viewport, view };
  }, []);

  const zoomAt = useCallback(
    (factor: number, clientX?: number, clientY?: number) => {
      const svg = svgRef.current;
      const viewport = viewportRef.current;
      if (!svg || !viewport) {
        return;
      }

      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }

      const currentView = viewport.view;
      const anchorX =
        currentView.x +
        (((clientX ?? rect.left + rect.width / 2) - rect.left) / rect.width) *
          currentView.width;
      const anchorY =
        currentView.y +
        (((clientY ?? rect.top + rect.height / 2) - rect.top) / rect.height) *
          currentView.height;
      const width = Math.min(
        viewport.fit.width * 4,
        Math.max(viewport.fit.width / 8, currentView.width * factor),
      );
      const ratio = width / currentView.width;

      applyView({
        x: anchorX - (anchorX - currentView.x) * ratio,
        y: anchorY - (anchorY - currentView.y) * ratio,
        width,
        height: currentView.height * ratio,
      });
    },
    [applyView],
  );

  const fitGraph = useCallback(() => {
    const viewport = viewportRef.current;
    if (viewport) {
      applyView(viewport.fit);
    }
  }, [applyView]);

  useEffect(() => {
    let cancelled = false;
    let activeSvg: SVGSVGElement | undefined;
    let removeInteractions = () => {};
    setStatus("loading");

    void getViz()
      .then((viz) => {
        if (cancelled || !containerRef.current) {
          return;
        }

        const svg = viz.renderSVGElement(
          buildMachineDot(machine, { current, orientation }),
          { engine: "dot" },
        );
        activeSvg = svg;
        const graphView = readViewBox(svg);
        const container = containerRef.current;
        if (!graphView || !container) {
          throw new Error("Graphviz returned an invalid SVG viewport");
        }

        const fit = fitViewBox(
          graphView,
          Math.max(container.clientWidth, 1),
          Math.max(container.clientHeight, 1),
        );
        const previous = viewportRef.current;
        const view = previous?.key === viewportKey ? previous.view : fit;

        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", `${machine.name} labelled transition system`);
        writeViewBox(svg, view);
        svgRef.current = svg;
        viewportRef.current = { key: viewportKey, view, fit };

        let drag:
          | { pointerId: number; clientX: number; clientY: number }
          | undefined;

        const handleWheel = (event: WheelEvent) => {
          event.preventDefault();
          zoomAt(event.deltaY < 0 ? 0.86 : 1.16, event.clientX, event.clientY);
        };
        const handlePointerDown = (event: PointerEvent) => {
          const target = event.target;
          if (
            event.button !== 0 ||
            (target instanceof Element && target.closest(".enabled-transition"))
          ) {
            return;
          }

          drag = {
            pointerId: event.pointerId,
            clientX: event.clientX,
            clientY: event.clientY,
          };
          svg.setPointerCapture(event.pointerId);
          svg.classList.add("is-panning");
        };
        const handlePointerMove = (event: PointerEvent) => {
          const viewport = viewportRef.current;
          if (!drag || drag.pointerId !== event.pointerId || !viewport) {
            return;
          }

          event.preventDefault();
          const rect = svg.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) {
            return;
          }
          const deltaX =
            ((event.clientX - drag.clientX) / rect.width) * viewport.view.width;
          const deltaY =
            ((event.clientY - drag.clientY) / rect.height) * viewport.view.height;
          drag.clientX = event.clientX;
          drag.clientY = event.clientY;
          applyView({
            ...viewport.view,
            x: viewport.view.x - deltaX,
            y: viewport.view.y - deltaY,
          });
        };
        const stopDragging = (event: PointerEvent) => {
          if (!drag || drag.pointerId !== event.pointerId) {
            return;
          }

          if (svg.hasPointerCapture(event.pointerId)) {
            svg.releasePointerCapture(event.pointerId);
          }
          drag = undefined;
          svg.classList.remove("is-panning");
        };

        svg.addEventListener("wheel", handleWheel, { passive: false });
        svg.addEventListener("pointerdown", handlePointerDown);
        svg.addEventListener("pointermove", handlePointerMove);
        svg.addEventListener("pointerup", stopDragging);
        svg.addEventListener("pointercancel", stopDragging);
        removeInteractions = () => {
          svg.removeEventListener("wheel", handleWheel);
          svg.removeEventListener("pointerdown", handlePointerDown);
          svg.removeEventListener("pointermove", handlePointerMove);
          svg.removeEventListener("pointerup", stopDragging);
          svg.removeEventListener("pointercancel", stopDragging);
        };

        for (const element of svg.querySelectorAll<SVGGElement>(
          ".enabled-transition",
        )) {
          const index = Number(element.id.replace("transition-", ""));
          const transition = machine.transitions[index];
          if (!transition) {
            continue;
          }

          element.setAttribute("tabindex", "0");
          element.setAttribute(
            "aria-label",
            `${transition.action} to state ${displayState(transition.to)}`,
          );
          element.addEventListener("click", () => onTransition(transition, index));
          element.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onTransition(transition, index);
            }
          });
        }

        containerRef.current.replaceChildren(svg);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
        }
      });

    return () => {
      cancelled = true;
      removeInteractions();
      if (svgRef.current === activeSvg) {
        svgRef.current = null;
      }
    };
  }, [applyView, current, machine, onTransition, orientation, viewportKey, zoomAt]);

  return (
    <div className="lts-graph-stage">
      <div ref={containerRef} className="lts-graph" />
      <div className="graph-navigation" aria-label="Graph navigation controls">
        <button
          type="button"
          onClick={() => zoomAt(0.8)}
          disabled={status !== "ready"}
          aria-label="Zoom in"
          title="Zoom in"
        >
          <ZoomIn size={16} />
        </button>
        <button
          type="button"
          onClick={() => zoomAt(1.25)}
          disabled={status !== "ready"}
          aria-label="Zoom out"
          title="Zoom out"
        >
          <ZoomOut size={16} />
        </button>
        <button
          type="button"
          onClick={fitGraph}
          disabled={status !== "ready"}
          aria-label="Fit graph to view"
          title="Fit graph to view"
        >
          <Maximize2 size={16} />
        </button>
      </div>
      {status === "ready" && (
        <p className="graph-navigation-hint">Scroll to zoom · drag to move</p>
      )}
      {status === "loading" && <div className="graph-status">Laying out states…</div>}
      {status === "error" && (
        <div className="graph-status graph-status--error">
          The state graph could not be rendered.
        </div>
      )}
    </div>
  );
}

function createSessions(choices: MachineChoice[]): Record<string, MachineSession> {
  return Object.fromEntries(
    choices.map((choice) => [
      choice.id,
      { current: choice.machine.initial, trace: [] },
    ]),
  );
}

export function LtsPlayground({ project, variantId }: LtsPlaygroundProps) {
  const variant = project.variants.find((candidate) => candidate.id === variantId)!;
  const choices = useMemo<MachineChoice[]>(() => {
    const sketch = createSystemSketch(project, variantId);
    const components = variant.machines.map((machine, index) => ({
      id: `component-${index}`,
      label: sketch.processes[index]?.name ?? machine.name,
      machine,
      property: false,
    }));

    if (variant.property) {
      components.push({
        id: "property-monitor",
        label: variant.property.name,
        machine: variant.property,
        property: true,
      });
    }

    return components;
  }, [project, variant, variantId]);
  const [selectedId, setSelectedId] = useState(choices[0]!.id);
  const [sessions, setSessions] = useState(() => createSessions(choices));
  const [orientation, setOrientation] = useState<Orientation>("horizontal");

  useEffect(() => {
    setSelectedId(choices[0]!.id);
    setSessions(createSessions(choices));
  }, [choices]);

  const selected = choices.find((choice) => choice.id === selectedId) ?? choices[0]!;
  const session = sessions[selected.id] ?? {
    current: selected.machine.initial,
    trace: [],
  };
  const enabledTransitions = selected.machine.transitions
    .map((transition, index) => ({ transition, index }))
    .filter(({ transition }) => statesEqual(transition.from, session.current));
  const actionCounts = new Map<string, number>();
  for (const { transition } of enabledTransitions) {
    actionCounts.set(transition.action, (actionCounts.get(transition.action) ?? 0) + 1);
  }

  const takeTransition = useCallback(
    (transition: Transition, transitionIndex: number) => {
      setSessions((currentSessions) => {
        const currentSession = currentSessions[selected.id];
        if (
          !currentSession ||
          !statesEqual(transition.from, currentSession.current)
        ) {
          return currentSessions;
        }

        return {
          ...currentSessions,
          [selected.id]: {
            current: transition.to,
            trace: [
              ...currentSession.trace,
              {
                transitionIndex,
                from: transition.from,
                action: transition.action,
                to: transition.to,
              },
            ],
          },
        };
      });
    },
    [selected.id],
  );

  function resetSelected() {
    setSessions((currentSessions) => ({
      ...currentSessions,
      [selected.id]: { current: selected.machine.initial, trace: [] },
    }));
  }

  function undoSelected() {
    const previousStep = session.trace.at(-1);
    if (!previousStep) {
      return;
    }

    setSessions((currentSessions) => ({
      ...currentSessions,
      [selected.id]: {
        current: previousStep.from,
        trace: session.trace.slice(0, -1),
      },
    }));
  }

  const terminalLabel =
    session.current === ERROR_STATE
      ? "ERROR reached"
      : selected.machine.end !== NO_END &&
          statesEqual(session.current, selected.machine.end)
        ? "END reached"
        : "No enabled actions";

  return (
    <div className="lts-playground">
      <header className="playground-toolbar">
        <div className="machine-selector">
          <label htmlFor="machine-select">Process</label>
          <select
            id="machine-select"
            value={selected.id}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {choices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}{choice.property ? " — property monitor" : ""}
              </option>
            ))}
          </select>
        </div>

        <div className="current-state-readout">
          <span>Current state</span>
          <strong>{displayState(session.current)}</strong>
        </div>

        <div className="playground-tools">
          <button
            type="button"
            onClick={undoSelected}
            disabled={session.trace.length === 0}
            aria-label="Undo last transition"
            title="Undo last transition"
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            onClick={resetSelected}
            disabled={session.trace.length === 0}
            aria-label="Reset process"
            title="Reset process"
          >
            <RefreshCcw size={16} />
          </button>
          <button
            type="button"
            onClick={() =>
              setOrientation((current) =>
                current === "horizontal" ? "vertical" : "horizontal",
              )
            }
            aria-label="Rotate graph layout"
            title="Rotate graph layout"
          >
            <RotateCw size={16} />
          </button>
        </div>
      </header>

      <GraphvizMachine
        machine={selected.machine}
        current={session.current}
        orientation={orientation}
        onTransition={takeTransition}
      />

      <div className="playground-console">
        <section className="enabled-actions" aria-labelledby="enabled-actions-title">
          <div className="console-heading">
            <div>
              <p className="eyebrow">Step the process</p>
              <h2 id="enabled-actions-title">Enabled actions</h2>
            </div>
            <span>{enabledTransitions.length}</span>
          </div>

          {enabledTransitions.length > 0 ? (
            <div className="action-list">
              {enabledTransitions.map(({ transition, index }) => {
                const nondeterministic = (actionCounts.get(transition.action) ?? 0) > 1;
                return (
                  <button
                    key={`${index}-${stateKey(transition.to)}`}
                    type="button"
                    onClick={() => takeTransition(transition, index)}
                  >
                    <span className="action-icon" aria-hidden="true">
                      <ArrowDownRight size={15} />
                    </span>
                    <span>
                      <strong>{transition.action}</strong>
                      <small>
                        to {displayState(transition.to)}
                        {nondeterministic ? " · nondeterministic branch" : ""}
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="terminal-state">
              <CornerDownLeft size={17} aria-hidden="true" />
              <span>{terminalLabel}</span>
            </div>
          )}
        </section>

        <section className="execution-trace" aria-labelledby="execution-trace-title">
          <div className="console-heading">
            <div>
              <p className="eyebrow">This run</p>
              <h2 id="execution-trace-title">Execution trace</h2>
            </div>
            <span>{session.trace.length}</span>
          </div>

          {session.trace.length === 0 ? (
            <p className="trace-empty">Choose an enabled edge or action to begin.</p>
          ) : (
            <ol className="trace-list">
              {session.trace.map((step, index) => (
                <li key={`${index}-${step.transitionIndex}`}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step.action}</strong>
                  <small>
                    {displayState(step.from)} → {displayState(step.to)}
                  </small>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
