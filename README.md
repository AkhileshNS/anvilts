# AnviLTS

AnviLTS is an MCP server for a reconstructed LTSA (Labelled Transition System Analyser) engine. It makes LTSA's academic verification capabilities available to users and AI coding agents through structured tools for modelling, composition, deadlock detection, safety-property verification, fair-choice progress analysis, and counterexample visualization.

An agent can inspect concurrent code, construct a finite labelled transition system with the user, and submit that model to AnviLTS for exhaustive verification. Every modeled transition can retain repository-relative source evidence, while a model-wide abstraction ledger records assumptions, omissions, unresolved questions, and the source revision. This makes the human approval step auditable and gives LLMs a mathematical way to test their concurrency claims without hiding how code became a model.

```mermaid
flowchart LR
    A["Repository + verification question"] --> B["Agent inspects concurrent behavior"]
    B --> C["User confirms the finite abstraction"]
    C --> D["AnviLTS composes the component LTSes"]
    D --> E["Exhaustive deadlock, safety, and progress check"]
    E --> F["Shortest trace + optional SVG graph"]
```

## MCP server

AnviLTS runs as a local MCP server using the `stdio` transport and exposes four tools:

- `validate_model`: validate component LTS definitions, provenance coverage, abstraction decisions, optional safety monitors, and progress properties.
- `compose_lts`: construct the reachable parallel composition.
- `verify_lts`: detect deadlocks, reserved ERROR states, safety-property violations, and LTSA-style progress violations.
- `render_lts`: render a dark SVG state graph with an optional highlighted trace or recurrent terminal component.

The included Codex plugin provides the repository-inspection, model-review, verification, and counterexample-explanation workflow.

The built MCP server entry point is:

```text
plugins/anvilts/mcp/server.mjs
```

For example, a VS Code workspace can add `.vscode/mcp.json`:

```json
{
  "servers": {
    "anvilts": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/plugins/anvilts/mcp/server.mjs"],
      "cwd": "${workspaceFolder}/plugins/anvilts"
    }
  }
}
```

Use the same command and absolute bundle path in another MCP client according to that client's configuration format. Node.js 22.18 or newer is required.

## Install the Codex plugin

The repository includes a local plugin marketplace at `.agents/plugins/marketplace.json`. In the ChatGPT desktop app, restart after cloning, open **Plugins**, choose **AnviLTS Development**, install **AnviLTS**, and start a new task.

Codex CLI users can instead run:

```sh
codex plugin marketplace add .
codex plugin add anvilts@anvilts-local
```

## Judge demos

The examples are intentionally ordinary service code. Their names and comments do not disclose the concurrency defect.

### Deadlock detection: Document service

> Use $verify-concurrent-system to inspect `examples/document-service`. Document deletion occasionally stops responding while the audit uploader is active. Determine whether concurrency could explain it.

This exercises coordination between a document store and a buffered audit subsystem. The composed model reaches a state where each operation holds one resource while waiting for the other.

### Safety-property verification: Session service

> Use $verify-concurrent-system to inspect `examples/session-service`. Sessions created while signing keys rotate occasionally remain active with a retired key epoch. Determine whether an interleaving can violate the invariant that every stored session uses the current key epoch.

This exercises a finite safety monitor: the service continues running, but one ordering of epoch reads, rotation, expiry, and publication reaches an invalid state.

### Progress verification: Report service

> Use $verify-concurrent-system to inspect `examples/report-service`. When a month-end batch contains an archived account, workers remain active and snapshot retries keep appearing, but the batch never returns. Determine whether this is a deadlock or a progress failure and verify the appropriate property.

This exercises conditional progress under LTSA fair choice: if snapshot retries recur infinitely, report completion must also recur. The worker keeps taking transitions, so the failure is not a deadlock.

For each demo, Codex should inspect the code, attach file-and-line evidence to the proposed transitions, surface assumptions and omissions, and ask for confirmation. Once approved, AnviLTS returns a shortest finite counterexample or a shortest prefix into a violating recurrent region with the transition evidence preserved. The user can then ask Codex to fix the implementation and verify the revised model.

AnviLTS proves the approved model under its stated assumptions. It does not claim that model extraction establishes source-code equivalence.

## Development

```sh
npm install
npm run typecheck
npm run test:provenance
npm run test:progress
npm run test:mcp
npm run build
npm run test:plugin
npm run parity
```

`npm run parity` compares the engine against 62 LTSA textbook-derived fixtures. The current suite has full verdict and graph parity: 62/62, with zero graph differences.

## Verification semantics

- Private actions interleave.
- Shared non-`tau` actions require every component whose alphabet contains the action to participate.
- `tau` is always private and never synchronizes.
- Reachable non-END states with no eligible transition are deadlocks.
- Safety properties are passive deterministic monitors; disallowed relevant actions enter ERROR.
- Breadth-first parent links produce a shortest counterexample trace.
- Progress properties are checked over cyclic terminal strongly connected components under LTSA fair-choice semantics.
- Conditional progress requires a progress action to recur whenever a condition action recurs; it is not a per-request response guarantee.
- MCP calls default to a 100,000 reachable-state limit to prevent accidental state explosion.

See [IDEA.md](IDEA.md) for the product rationale and [the model reference](plugins/anvilts/skills/verify-concurrent-system/references/lts-model.md) for the JSON contract.
