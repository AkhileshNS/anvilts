import { FormEvent, useState } from "react";
import { ArrowRight, ArrowUp } from "lucide-react";
import { Link, Route, Routes, useNavigate } from "react-router-dom";

const EXAMPLES = ["Coin", "Client–Server", "Reader–Writer", "Maker–User"];
const TABS = ["Whiteboard", "Output", "Logs"] as const;

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
            {EXAMPLES.map((example) => (
              <button key={example} type="button" onClick={() => navigate("/workspace")}>
                {example}
              </button>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function EmptyPreview({ tab }: { tab: WorkspaceTab }) {
  const content: Record<WorkspaceTab, { eyebrow: string; title: string; body: string }> = {
    Whiteboard: {
      eyebrow: "Visual model",
      title: "Your system will take shape here",
      body: "Processes, states, and shared actions will appear as you describe them.",
    },
    Output: {
      eyebrow: "Verification",
      title: "No analysis yet",
      body: "Deadlocks, property violations, and counterexample traces will appear here.",
    },
    Logs: {
      eyebrow: "Engine activity",
      title: "Nothing to report",
      body: "Composition and reachability details will be available here when a check runs.",
    },
  };

  const selected = content[tab];

  return (
    <div className={`empty-preview empty-preview--${tab.toLowerCase()}`}>
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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("Whiteboard");

  return (
    <main className="workspace-page">
      <header className="workspace-header">
        <Link to="/" className="wordmark" aria-label="AnviLTS home">
          <Mark small />
          <span>AnviLTS</span>
        </Link>
        <span className="workspace-label">Untitled system</span>
        <button type="button" className="header-action" disabled>
          Run verification
        </button>
      </header>

      <div className="workspace-shell">
        <section className="chat-panel" aria-labelledby="chat-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Conversation</p>
              <h1 id="chat-title">Build the model together</h1>
            </div>
            <span className="status-dot" aria-label="Ready" />
          </div>

          <div className="chat-empty">
            <div className="chat-orbit" aria-hidden="true"><span /></div>
            <h2>Describe how your system behaves</h2>
            <p>I’ll ask questions and help turn the important interactions into a model.</p>
          </div>

          <div className="composer-wrap">
            <div className="model-status"><span /> Ready to model</div>
            <form className="composer" onSubmit={(event) => event.preventDefault()}>
              <label htmlFor="chat-input" className="sr-only">Message AnviLTS</label>
              <textarea id="chat-input" placeholder="Add a detail or ask a question…" rows={2} />
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
            <EmptyPreview tab={activeTab} />
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
