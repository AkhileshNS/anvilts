---
name: verify-concurrent-system
description: Inspect a codebase or service design, extract a user-approved finite labelled transition system, and use the AnviLTS MCP tools to check deadlocks, ERROR states, safety properties, and LTSA-style fair-choice progress with visual counterexamples. Use when the user asks whether concurrent code, workers, services, queues, locks, protocols, or resource coordination can deadlock, livelock, starve, stop making progress, or violate an invariant.
---

# Verify Concurrent System

Use repository access for implementation evidence and AnviLTS for deterministic model checking. Never claim that an LLM-generated abstraction proves the source code itself.

## Workflow

1. Inspect the relevant code paths, configuration, tests, and documentation. Identify concurrent actors, persistent resources, ordering constraints, blocking operations, retries, timeouts, and externally visible events.
2. Decide whether the question is suitable for a finite LTS abstraction. Stop and explain the mismatch when there is no concurrency interaction, the requested claim is not a safety/deadlock question, or no defensible finite abstraction is possible.
3. Ask only targeted questions that source evidence cannot answer. Resolve behavior that materially changes transitions, synchronization, termination, bounds, or the property.
4. Present a compact abstraction proposal that clearly explains:
   - **Scope:** the specific concurrent behavior to abstract and which implementation details will be included or deliberately omitted;
   - **Rationale:** why that behavior is relevant to the reported risk and suitable for a finite LTS check;
   - **Model:** component processes, local states in plain language, actions, and which actions synchronize;
   - **Claim:** the exact deadlock, safety, basic progress, or conditional progress property AnviLTS will check;
   - **Assumptions:** bounds, environmental behavior, fairness, failures, timeouts, and other simplifications that affect the result.
5. Ask the user explicitly whether this abstraction accurately represents the behavior and risk they want checked. Invite corrections to the scope, processes, synchronization, assumptions, or property. Do not treat a generic acknowledgment as approval when material details remain ambiguous. Do not invoke verification tools before confirmation unless the user explicitly asked for a provisional model and the result is clearly labeled provisional.
6. Read [references/lts-model.md](references/lts-model.md), construct the component JSON, optional safety monitor, and optional progress properties, then call `validate_model`.
7. Correct model errors without changing confirmed domain assumptions. Ask again if a correction changes the meaning of the abstraction.
8. Call `verify_lts` and report the result with the checked property, explored-state counts, assumptions/bounds, and shortest counterexample when one exists. For progress, report that LTSA fair-choice semantics were used and distinguish the finite prefix from the recurrent terminal component. Say, "The property is satisfied by this model under these assumptions," never, "the code is proven safe."
9. When verification finds a deadlock, ERROR state, safety-property violation, or progress violation, explain the result and offer to visualize it. For progress, explain which actions recur and which required progress actions are absent. Do not call `render_lts` until the user agrees.
10. If the user accepts the visualization offer, call `render_lts` with the same machines, the safety property when applicable, and the exact trace returned by `verify_lts`. For progress, also pass the returned `terminalStates` as `highlightStates`. Present the resulting graph and briefly map the highlighted path or recurrent region back to the relevant code behavior. Do not reconstruct or alter the diagnostic for presentation.

## Modeling Discipline

- Derive transitions from source evidence and confirmed behavior; do not invent happy-path recovery or fairness.
- Model only state that can affect enabled actions or the property.
- Preserve meaningful nondeterminism when the implementation permits multiple outcomes.
- Treat timeouts, cancellation, crashes, and retries as explicit actions only when they affect the question.
- Treat progress as an infinite-execution claim under LTSA fair choice. State this strong fairness assumption explicitly and obtain confirmation. If realistic scheduling may violate it, model priority or adverse scheduling behavior rather than silently strengthening the scheduler.
- Keep component names and action names connected to code symbols so counterexamples can be mapped back to the repository.
- If the reachable-state limit is exceeded, reduce irrelevant state or ask the user to approve a stronger bound. Do not silently weaken the property.

## Result Interpretation

- A deadlock is a reachable non-END state with no eligible transition.
- A property violation is a reachable transition into the monitor's ERROR state.
- A progress violation is a reachable cyclic terminal component in which the required progress actions do not recur under LTSA fair-choice semantics.
- Conditional progress means that if a condition action recurs infinitely often, at least one progress action must also recur infinitely often. It does not prove that every individual request eventually receives a response.
- A deadlock or safety trace is a shortest finite failing trace. A progress `prefixTrace` is a shortest path into the violating recurrent region; `terminalStates` describes that region.
- A passing result covers only reachable behavior represented by the model and its stated bounds.
