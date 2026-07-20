import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  Pause,
  Play,
  RefreshCcw,
  ShieldCheck,
  ShieldX,
  SkipBack,
} from "lucide-react";

import type { DemoProject } from "../examples/demo-projects";
import { END_STATE, ERROR_STATE, statesEqual, type State } from "../state-machine";
import {
  verifyStateMachines,
  type VerificationFinding,
  type VerificationReport,
} from "../verification";

interface VerificationViewProps {
  project: DemoProject;
  variantId: string;
}

interface AnalysisResult {
  report?: VerificationReport;
  error?: string;
  elapsedMs: number;
}

interface TraceFrame {
  state: State;
  action?: string;
}

function displayState(state: State): string {
  if (Array.isArray(state)) {
    return `(${state.map(displayState).join(", ")})`;
  }

  return String(state);
}

function runAnalysis(
  project: DemoProject,
  variantId: string,
): AnalysisResult {
  const started = performance.now();

  try {
    const variant = project.variants.find((candidate) => candidate.id === variantId);
    if (!variant) {
      throw new Error("The selected verification scenario does not exist.");
    }

    return {
      report: verifyStateMachines(variant.machines, variant.property),
      elapsedMs: performance.now() - started,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: performance.now() - started,
    };
  }
}

function createTraceFrames(
  report: VerificationReport,
  finding: VerificationFinding,
): TraceFrame[] {
  const initial = finding.monitored
    ? report.property!.monitoredSystem.initial
    : report.system.initial;

  return [
    { state: finding.trace[0]?.from ?? initial },
    ...finding.trace.map((transition) => ({
      state: transition.to,
      action: transition.action,
    })),
  ];
}

function splitSnapshot(
  state: State,
  monitored: boolean,
): { system?: State; property?: State; terminal?: string } {
  if (!monitored) {
    return state === END_STATE || state === ERROR_STATE
      ? { terminal: state }
      : { system: state };
  }

  if (state === END_STATE || state === ERROR_STATE) {
    return { property: state, terminal: state };
  }

  const [system, property] = state as State[];
  return { system, property };
}

function componentStates(state: State | undefined, count: number): State[] | undefined {
  if (state === undefined || state === END_STATE || state === ERROR_STATE) {
    return undefined;
  }

  if (count === 1) {
    return [state];
  }

  return Array.isArray(state) ? state : undefined;
}

function ResultMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "pass" | "fail" | "neutral";
}) {
  return (
    <article className={`verification-metric verification-metric--${tone}`}>
      <div>
        {tone === "pass" ? (
          <Check size={15} aria-hidden="true" />
        ) : tone === "fail" ? (
          <AlertTriangle size={15} aria-hidden="true" />
        ) : null}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </article>
  );
}

function TraceReplay({
  report,
  finding,
  processNames,
}: {
  report: VerificationReport;
  finding: VerificationFinding;
  processNames: string[];
}) {
  const frames = useMemo(
    () => createTraceFrames(report, finding),
    [finding, report],
  );
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const lastFrame = frames.length - 1;

  useEffect(() => {
    setCursor(0);
    setPlaying(false);
  }, [frames]);

  useEffect(() => {
    if (!playing) {
      return;
    }

    if (cursor >= lastFrame) {
      setPlaying(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setCursor((current) => Math.min(current + 1, lastFrame));
    }, 850);
    return () => window.clearTimeout(timer);
  }, [cursor, lastFrame, playing]);

  const frame = frames[cursor]!;
  const previousFrame = frames[Math.max(0, cursor - 1)]!;
  const snapshot = splitSnapshot(frame.state, finding.monitored);
  const previousSnapshot = splitSnapshot(previousFrame.state, finding.monitored);
  const fallbackSnapshot = [...frames]
    .slice(0, cursor)
    .reverse()
    .map((candidate) => splitSnapshot(candidate.state, finding.monitored))
    .find((candidate) => candidate.system !== undefined);
  const visibleSystem = snapshot.system ?? fallbackSnapshot?.system;
  const visibleStates = componentStates(visibleSystem, processNames.length);
  const previousStates = componentStates(previousSnapshot.system, processNames.length);
  const terminal = cursor === lastFrame;

  function moveTo(next: number) {
    setPlaying(false);
    setCursor(Math.max(0, Math.min(next, lastFrame)));
  }

  return (
    <section className="trace-replay" aria-labelledby="trace-replay-title">
      <div className="trace-replay-heading">
        <div>
          <p className="eyebrow">Shortest counterexample</p>
          <h2 id="trace-replay-title">Replay the failing execution</h2>
          <p>{finding.description}</p>
        </div>
        <span>{finding.trace.length} actions</span>
      </div>

      <div className="trace-transport" aria-label="Trace playback controls">
        <button
          type="button"
          onClick={() => moveTo(0)}
          disabled={cursor === 0}
          aria-label="Return to initial state"
          title="Return to initial state"
        >
          <SkipBack size={16} />
        </button>
        <button
          type="button"
          onClick={() => moveTo(cursor - 1)}
          disabled={cursor === 0}
          aria-label="Previous trace step"
          title="Previous step"
        >
          <ChevronLeft size={17} />
        </button>
        <button
          type="button"
          className="trace-play-button"
          onClick={() => {
            if (cursor === lastFrame) {
              setCursor(0);
            }
            setPlaying((current) => !current);
          }}
          aria-label={playing ? "Pause trace" : "Play trace"}
          title={playing ? "Pause trace" : "Play trace"}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button
          type="button"
          onClick={() => moveTo(cursor + 1)}
          disabled={cursor === lastFrame}
          aria-label="Next trace step"
          title="Next step"
        >
          <ChevronRight size={17} />
        </button>
        <span>
          Step {cursor} of {lastFrame}
        </span>
      </div>

      <div className="trace-timeline" aria-label="Counterexample action sequence">
        {frames.map((candidate, index) => (
          <div className="trace-timeline-step" key={`${index}-${candidate.action ?? "initial"}`}>
            {index > 0 && (
              <span className="trace-action-label">{candidate.action}</span>
            )}
            <button
              type="button"
              className={`${index === cursor ? "active " : ""}${
                index < cursor ? "visited " : ""
              }${index === lastFrame ? "terminal" : ""}`}
              onClick={() => moveTo(index)}
              aria-label={
                index === 0
                  ? "Initial state"
                  : `After ${candidate.action}: ${displayState(candidate.state)}`
              }
            >
              <span>{index}</span>
              <small>{index === 0 ? "initial" : displayState(candidate.state)}</small>
            </button>
          </div>
        ))}
      </div>

      <div className="trace-snapshot">
        <header>
          <div>
            <p className="eyebrow">Current snapshot</p>
            <h3>{cursor === 0 ? "Initial state" : frame.action}</h3>
          </div>
          {terminal && (
            <span className="trace-terminal-badge">
              <CircleStop size={14} aria-hidden="true" />
              {finding.kind === "deadlock" ? "No actions enabled" : "ERROR reached"}
            </span>
          )}
        </header>

        <div className="process-state-list">
          {processNames.map((name, index) => {
            const state = visibleStates?.[index];
            const previousState = previousStates?.[index];
            const changed =
              cursor > 0 &&
              state !== undefined &&
              previousState !== undefined &&
              !statesEqual(state, previousState);

            return (
              <div className={changed ? "changed" : ""} key={`${name}-${index}`}>
                <span>{name}</span>
                <strong>{state === undefined ? "—" : displayState(state)}</strong>
                <small>
                  {snapshot.system === undefined && visibleSystem !== undefined
                    ? "state before failure"
                    : changed
                      ? `from ${displayState(previousState!)}`
                      : "unchanged"}
                </small>
              </div>
            );
          })}

          {report.property && (
            <div
              className={
                snapshot.property === ERROR_STATE
                  ? "property-state property-state--error"
                  : "property-state"
              }
            >
              <span>{report.property.definition.name} · property monitor</span>
              <strong>
                {snapshot.property === undefined
                  ? "—"
                  : displayState(snapshot.property)}
              </strong>
              <small>
                {snapshot.property === ERROR_STATE
                  ? "forbidden action observed"
                  : "monitor state"}
              </small>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function VerificationView({ project, variantId }: VerificationViewProps) {
  const [run, setRun] = useState(0);
  const analysis = useMemo(
    () => runAnalysis(project, variantId),
    [project, run, variantId],
  );
  const variant = project.variants.find((candidate) => candidate.id === variantId)!;
  const report = analysis.report;

  if (!report) {
    return (
      <div className="verification-error" role="alert">
        <AlertTriangle size={21} aria-hidden="true" />
        <div>
          <p className="eyebrow">Verification failed</p>
          <h2>The model could not be analyzed</h2>
          <p>{analysis.error}</p>
        </div>
      </div>
    );
  }

  const deadlockCount = report.systemReachability.deadlocks.length;
  const propertyViolationCount = report.property?.reachability.violations.length ?? 0;
  const modelErrorCount = report.systemReachability.violations.length;
  const safetyFailureCount = propertyViolationCount + modelErrorCount;
  const propertyStates = report.property?.reachability.states.length;
  const propertyTransitions = report.property?.reachability.transitions.length;
  const title = report.passed
    ? "No failures found in the reachable model"
    : report.finding!.kind === "deadlock"
      ? "Deadlock detected"
      : report.finding!.kind === "property-violation"
        ? "Safety property violated"
        : "Reachable ERROR state detected";

  return (
    <div className="verification-view">
      <header className={`verification-hero${report.passed ? " passed" : " failed"}`}>
        <span className="verification-verdict-icon" aria-hidden="true">
          {report.passed ? <ShieldCheck size={25} /> : <ShieldX size={25} />}
        </span>
        <div>
          <p className="eyebrow">
            {report.passed ? "Verification passed" : "Counterexample found"}
          </p>
          <h1>{title}</h1>
          <p>
            {report.passed
              ? "Every reachable state passed the configured deadlock and safety checks."
              : report.finding!.description}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setRun((current) => current + 1)}
          title="Run verification again"
        >
          <RefreshCcw size={15} aria-hidden="true" />
          Run again
        </button>
      </header>

      <section className="verification-metrics" aria-label="Verification results">
        <ResultMetric
          label="Deadlock freedom"
          value={deadlockCount === 0 ? "Passed" : "Failed"}
          detail={
            deadlockCount === 0
              ? "No reachable deadlock states"
              : `${deadlockCount} reachable deadlock${deadlockCount === 1 ? "" : "s"}`
          }
          tone={deadlockCount === 0 ? "pass" : "fail"}
        />
        <ResultMetric
          label="Safety property"
          value={
            variant.property
              ? safetyFailureCount === 0
                ? "Passed"
                : "Failed"
              : modelErrorCount > 0
                ? "Failed"
                : "Not configured"
          }
          detail={
            variant.property
              ? `${variant.property.name} · ${propertyStates ?? 0} product states`
              : modelErrorCount > 0
                ? `${modelErrorCount} reachable ERROR state${modelErrorCount === 1 ? "" : "s"}`
                : "No property monitor supplied"
          }
          tone={
            safetyFailureCount > 0
              ? "fail"
              : variant.property
                ? "pass"
                : "neutral"
          }
        />
        <ResultMetric
          label="Reachable system"
          value={report.systemReachability.states.length.toLocaleString()}
          detail={`${report.systemReachability.transitions.length.toLocaleString()} explored transitions`}
        />
        <ResultMetric
          label="Analysis time"
          value={
            analysis.elapsedMs < 1
              ? "<1 ms"
              : `${analysis.elapsedMs.toFixed(1)} ms`
          }
          detail={
            propertyTransitions === undefined
              ? `${variant.machines.length} composed processes`
              : `${propertyTransitions.toLocaleString()} monitored transitions`
          }
        />
      </section>

      {report.finding ? (
        <TraceReplay
          key={`${variantId}-${run}`}
          report={report}
          finding={report.finding}
          processNames={variant.machines.map((machine) => machine.name)}
        />
      ) : (
        <section className="verification-success" aria-labelledby="success-title">
          <span aria-hidden="true">
            <ShieldCheck size={28} />
          </span>
          <div>
            <p className="eyebrow">Exhaustive reachable-state search</p>
            <h2 id="success-title">No counterexample exists in this model</h2>
            <p>
              The search visited each reachable state once and found neither an
              unintended terminal state nor a forbidden safety action.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
