---
name: verify-concurrent-system
description: Inspect a codebase or service design, extract a user-approved finite labelled transition system, and use the AnviLTS MCP tools to check deadlocks, ERROR states, and safety properties with visual counterexamples. Use when the user asks whether concurrent code, workers, services, queues, locks, protocols, or resource coordination can deadlock or violate an invariant.
---

# Verify Concurrent System

Use repository access for implementation evidence and AnviLTS for deterministic model checking. Never claim that an LLM-generated abstraction proves the source code itself.

## Workflow

1. Inspect the relevant code paths, configuration, tests, and documentation. Identify concurrent actors, persistent resources, ordering constraints, blocking operations, retries, timeouts, and externally visible events.
2. Decide whether the question is suitable for a finite LTS abstraction. Stop and explain the mismatch when there is no concurrency interaction, the requested claim is not a safety/deadlock question, or no defensible finite abstraction is possible.
3. Ask only targeted questions that source evidence cannot answer. Resolve behavior that materially changes transitions, synchronization, termination, bounds, or the property.
4. Present a compact abstraction proposal containing:
   - component processes and what each represents;
   - local states in plain language;
   - actions, including which actions synchronize;
   - bounds and assumptions;
   - the exact deadlock or safety claim to check.
5. Obtain explicit user confirmation of the abstraction. Do not invoke verification tools before confirmation unless the user explicitly asked for a provisional model and the result is clearly labeled provisional.
6. Read [references/lts-model.md](references/lts-model.md), construct the component JSON and optional property monitor, then call `validate_model`.
7. Correct model errors without changing confirmed domain assumptions. Ask again if a correction changes the meaning of the abstraction.
8. Call `verify_lts`. For a failure, call `render_lts` with the same machines, the property when applicable, and the returned trace. For a successful but nontrivial model, render the composition when a graph will improve understanding.
9. Report the result with the checked property, explored-state counts, assumptions/bounds, and shortest counterexample. Say: “The property is satisfied by this model under these assumptions,” never “the code is proven safe.”

## Modeling Discipline

- Derive transitions from source evidence and confirmed behavior; do not invent happy-path recovery or fairness.
- Model only state that can affect enabled actions or the property.
- Preserve meaningful nondeterminism when the implementation permits multiple outcomes.
- Treat timeouts, cancellation, crashes, and retries as explicit actions only when they affect the question.
- Keep component names and action names connected to code symbols so counterexamples can be mapped back to the repository.
- If the reachable-state limit is exceeded, reduce irrelevant state or ask the user to approve a stronger bound. Do not silently weaken the property.

## Result Interpretation

- A deadlock is a reachable non-END state with no eligible transition.
- A property violation is a reachable transition into the monitor's ERROR state.
- The returned trace is a shortest trace in the approved model, not necessarily the only failing execution.
- A passing result covers only reachable behavior represented by the model and its stated bounds.
