# AnviLTS

AnviLTS is an MCP server for a reconstructed LTSA (Labelled Transition System Analyser) engine. It makes LTSA's academic verification capabilities available to users and AI coding agents through structured tools for modelling, composition, deadlock detection, safety-property verification, fair-choice progress analysis, and counterexample visualization.

An agent can inspect concurrent code, construct a finite labelled transition system with the user, and submit that model to AnviLTS for exhaustive verification. This gives LLMs a mathematical way to test their concurrency claims, reducing the risk that a plausible explanation or proposed fix is accepted without proof.

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

- `validate_model`: validate component LTS definitions, optional safety monitors, and progress properties.
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

### Document service

> Use $verify-concurrent-system to inspect `examples/document-service`. Document deletion occasionally stops responding while the audit uploader is active. Determine whether concurrency could explain it.

This exercises coordination between a document store and a buffered audit subsystem.

### Report service

> Use $verify-concurrent-system to inspect `examples/report-service`. Month-end batches reliably stop making progress when several accounts are processed together. Find the concurrency failure and verify your explanation.

This exercises a bounded executor and nested background work rather than explicit lock ordering.

### Session service

> Use $verify-concurrent-system to inspect `examples/session-service`. We see rare authentication stalls when key rotation overlaps heavy session refresh traffic. Determine whether the implementation permits a permanent wait.

This exercises asynchronous coordination across the session registry and key manager.

For each demo, Codex should inspect the code, propose a finite abstraction, and ask for confirmation. Once approved, AnviLTS validates the model and returns a shortest counterexample if the failure is reachable. The user can then ask Codex to fix the implementation and verify the revised model.

AnviLTS proves the approved model under its stated assumptions. It does not claim that model extraction establishes source-code equivalence.

## Development

```sh
npm install
npm run typecheck
npm run test:progress
npm run test:mcp
npm run build
npm run test:plugin
npm run parity
```

`npm run parity` compares the engine against 52 LTSA textbook-derived fixtures. The current suite has full verdict and graph parity: 52/52, with zero graph differences.

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
