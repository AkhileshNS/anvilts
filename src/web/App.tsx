import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { ArrowRight, ArrowUp, Check, LockKeyhole } from "lucide-react";
import { Link, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import {
  DEMO_PROJECTS,
  getDemoProject,
  type DemoProject,
} from "../examples/demo-projects";
import { createSystemSketch } from "../sketch/system-sketch";
import type { SceneChangeSummary } from "./Whiteboard";

const Whiteboard = lazy(() =>
  import("./Whiteboard").then((module) => ({ default: module.Whiteboard })),
);
const LtsPlayground = lazy(() =>
  import("./LtsPlayground").then((module) => ({
    default: module.LtsPlayground,
  })),
);
const VerificationView = lazy(() =>
  import("./VerificationView").then((module) => ({
    default: module.VerificationView,
  })),
);

const TABS = ["Whiteboard", "Processes", "Verification"] as const;

type WorkspaceTab = (typeof TABS)[number];

function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`mark${small ? " mark--small" : ""}`} aria-hidden="true">
      <span className="mark__ring" />
      <span className="mark__core">A</span>
    </span>
  );
}

function IntroPage() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState("");

  function enterWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigate("/workspace", { state: { prompt } });
  }

  return (
    <main className="intro-page">
      <section className="intro-card" aria-labelledby="intro-title">
        <div className="intro-heading">
          <Mark />
          <div>
            <h1 id="intro-title">AnviLTS</h1>
            <p>Model concurrent systems. Find the paths that break them.</p>
          </div>
        </div>

        <form className="prompt-form" onSubmit={enterWorkspace}>
          <label htmlFor="system-prompt">Describe the system you want to verify</label>
          <div className="prompt-box">
            <textarea
              id="system-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="For example: Two workers share a printer, but only one may use it at a time…"
              rows={3}
            />
            <button type="submit" aria-label="Open workspace">
              <ArrowRight aria-hidden="true" size={18} strokeWidth={2.25} />
            </button>
          </div>
        </form>

        <div className="examples" aria-label="Example systems">
          <span>or load an example</span>
          <div className="example-list">
            {DEMO_PROJECTS.map((example) => (
              <button
                key={example.id}
                type="button"
                onClick={() =>
                  navigate("/workspace", { state: { exampleId: example.id } })
                }
              >
                {example.shortTitle}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function EmptyPreview({ tab }: { tab: WorkspaceTab }) {
  const content: Record<
    WorkspaceTab,
    { eyebrow: string; title: string; body: string }
  > = {
    Whiteboard: {
      eyebrow: "Visual model",
      title: "Your system will take shape here",
      body: "Processes, states, and shared actions will appear as you describe them.",
    },
    Processes: {
      eyebrow: "Formal model",
      title: "Confirm the visual model first",
      body: "The component state machines become available after you approve the system sketch.",
    },
    Verification: {
      eyebrow: "Logic engine",
      title: "No verification yet",
      body: "Deadlocks, property violations, and counterexample traces will appear here.",
    },
  };
  const selected = content[tab];

  return (
    <div
      className={`empty-preview empty-preview--${tab.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="preview-glyph" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p className="eyebrow">{selected.eyebrow}</p>
      <h2>{selected.title}</h2>
      <p>{selected.body}</p>
    </div>
  );
}

function WorkspacePage() {
  const location = useLocation();
  const routeState = location.state as {
    exampleId?: string;
    prompt?: string;
  } | null;
  const project = getDemoProject(routeState?.exampleId);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("Whiteboard");
  const [sceneSummary, setSceneSummary] = useState<SceneChangeSummary>();
  const [selectedVariantId, setSelectedVariantId] = useState(
    project?.variants[0]?.id ?? "",
  );
  const [confirmedRevision, setConfirmedRevision] = useState<number | null>(null);

  useEffect(() => {
    setSelectedVariantId(project?.variants[0]?.id ?? "");
    setSceneSummary(undefined);
    setConfirmedRevision(null);
    setActiveTab("Whiteboard");
  }, [project]);

  const selectedVariant = project?.variants.find(
    (variant) => variant.id === selectedVariantId,
  );
  const sketch = useMemo(
    () => createSystemSketch(project, selectedVariantId),
    [project, selectedVariantId],
  );
  const currentRevision = sceneSummary?.revision ?? 0;
  const isConfirmed =
    selectedVariant !== undefined && confirmedRevision === currentRevision;

  function selectVariant(variantId: string) {
    setSelectedVariantId(variantId);
    setSceneSummary(undefined);
    setConfirmedRevision(null);
    setActiveTab("Whiteboard");
  }

  function recordSceneChange(summary: SceneChangeSummary) {
    setSceneSummary(summary);
    setConfirmedRevision(null);
  }

  function confirmModel() {
    setConfirmedRevision(currentRevision);
    setActiveTab("Processes");
  }

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <Link to="/" className="wordmark" aria-label="AnviLTS home">
          <Mark small />
          <span>AnviLTS</span>
        </Link>
        <span className="workspace-label">{project?.title ?? "Untitled system"}</span>
        <button
          type="button"
          className={`header-action${isConfirmed ? " header-action--ready" : ""}`}
          disabled={!isConfirmed}
          onClick={() => setActiveTab("Processes")}
        >
          {isConfirmed ? "Inspect formal model" : "Confirm model to continue"}
        </button>
      </header>

      <div className="workspace-shell">
        <section className="chat-panel" aria-labelledby="chat-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Review</p>
              <h1 id="chat-title">Confirm the system model</h1>
            </div>
            <span className="status-dot" aria-label="Ready" />
          </div>

          {project && selectedVariant ? (
            <div className="example-review">
              <div className="review-intro">
                <p className="eyebrow">Loaded example</p>
                <h2>{project.title}</h2>
                <p>{project.summary}</p>
              </div>

              {project.variants.length > 1 && (
                <fieldset className="variant-picker">
                  <legend>Scenario</legend>
                  {project.variants.map((variant) => (
                    <button
                      key={variant.id}
                      type="button"
                      className={variant.id === selectedVariantId ? "active" : ""}
                      aria-pressed={variant.id === selectedVariantId}
                      onClick={() => selectVariant(variant.id)}
                    >
                      <strong>{variant.label}</strong>
                      <span>{variant.description}</span>
                    </button>
                  ))}
                </fieldset>
              )}

              <section className="review-question" aria-labelledby="review-question-title">
                <p className="eyebrow">Verification question</p>
                <h3 id="review-question-title">{project.verificationQuestion}</h3>
              </section>

              <div className="review-inventory" aria-label="Model inventory">
                <span>{sketch.processes.length} processes</span>
                <span>{sketch.interactions.length} shared actions</span>
                <span>Revision {currentRevision}</span>
              </div>

              <div className={`confirmation-card${isConfirmed ? " confirmed" : ""}`}>
                <span className="confirmation-icon" aria-hidden="true">
                  {isConfirmed ? <Check size={18} /> : <LockKeyhole size={18} />}
                </span>
                <div>
                  <strong>
                    {isConfirmed ? "Model confirmed" : "Human confirmation required"}
                  </strong>
                  <p>
                    {isConfirmed
                      ? "The formal process models are now unlocked."
                      : "Review the whiteboard and approve it before formalization."}
                  </p>
                </div>
              </div>

              <button
                type="button"
                className="confirm-model-button"
                disabled={isConfirmed}
                onClick={confirmModel}
              >
                {isConfirmed ? "Model confirmed" : "Confirm this system model"}
                <ArrowRight size={17} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="chat-empty">
              <div className="chat-orbit" aria-hidden="true">
                <span />
              </div>
              <h2>Describe how your system behaves</h2>
              <p>
                The conversational modeling flow will be connected after the example
                workflow is complete.
              </p>
            </div>
          )}

          <div className="composer-wrap">
            <div className="model-status">
              <span />
              {sceneSummary
                ? `Whiteboard revision ${sceneSummary.revision} · ${sceneSummary.elementCount} elements`
                : "Ready for review"}
            </div>
            <form className="composer" onSubmit={(event) => event.preventDefault()}>
              <label htmlFor="chat-input" className="sr-only">
                Message AnviLTS
              </label>
              <textarea
                id="chat-input"
                placeholder="Conversation will be enabled after the example flow…"
                rows={2}
                disabled
              />
              <button type="submit" aria-label="Send message" disabled>
                <ArrowUp aria-hidden="true" size={17} strokeWidth={2.25} />
              </button>
            </form>
          </div>
        </section>

        <section className="preview-panel" aria-label="Model workspace">
          <div className="tabs" role="tablist" aria-label="Workspace views">
            {TABS.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                className={activeTab === tab ? "active" : ""}
                onClick={() => setActiveTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
          <div className="preview-content" role="tabpanel">
            {activeTab === "Whiteboard" ? (
              <Suspense
                fallback={<div className="whiteboard-loading">Preparing whiteboard…</div>}
              >
                <Whiteboard
                  key={`${project?.id ?? "untitled"}-${selectedVariantId}`}
                  project={project}
                  variantId={selectedVariantId}
                  onSceneChange={recordSceneChange}
                />
              </Suspense>
            ) : activeTab === "Processes" &&
              project &&
              selectedVariant &&
              isConfirmed ? (
              <Suspense
                fallback={<div className="graph-status">Loading process playground…</div>}
              >
                <LtsPlayground
                  project={project}
                  variantId={selectedVariant.id}
                />
              </Suspense>
            ) : activeTab === "Verification" &&
              project &&
              selectedVariant &&
              isConfirmed ? (
              <Suspense
                fallback={<div className="graph-status">Running verification…</div>}
              >
                <VerificationView
                  project={project}
                  variantId={selectedVariant.id}
                />
              </Suspense>
            ) : (
              <EmptyPreview tab={activeTab} />
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<IntroPage />} />
      <Route path="/workspace" element={<WorkspacePage />} />
      <Route path="*" element={<IntroPage />} />
    </Routes>
  );
}
