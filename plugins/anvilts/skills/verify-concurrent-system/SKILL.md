---
name: verify-concurrent-system
description: Inspect a codebase or service design, extract a user-approved finite labelled transition system, and use the AnviLTS MCP tools to check deadlocks, ERROR states, safety properties, and LTSA-style fair-choice progress with visual counterexamples. Use when the user asks whether concurrent code, workers, services, queues, locks, protocols, or resource coordination can deadlock, livelock, starve, stop making progress, or violate an invariant.
---

# Verify Concurrent System

Use repository access for implementation evidence and AnviLTS for deterministic model checking. Never claim that an LLM-generated abstraction proves the source code itself.

## Workflow

1. Inspect the relevant code paths, configuration, tests, and documentation. Identify concurrent actors, persistent resources, ordering constraints, blocking operations, retries, timeouts, and externally visible events. Record the source revision or snapshot being modeled.
2. Decide whether the question is suitable for a finite LTS abstraction. Stop and explain the mismatch when there is no concurrency interaction, the requested claim is not a safety/deadlock question, or no defensible finite abstraction is possible.
3. Ask only targeted questions that source evidence cannot answer. Resolve behavior that materially changes transitions, synchronization, termination, bounds, or the property.
4. Before presenting the abstraction, tell the user in plain language that you intend to turn the relevant part of their system into a small formal model so a verification engine can check the concurrency or safety claim. Explain that you will need them to confirm whether the model accurately represents their system. Adapt the wording naturally to the conversation; communicate the purpose without assuming familiarity with formal methods, LTS, or model checking. Then present a compact abstraction proposal that clearly explains:
   - **Scope:** the specific concurrent behavior to abstract and which implementation details will be included or deliberately omitted;
   - **Rationale:** why that behavior is relevant to the reported risk and suitable for a finite LTS check;
   - **Model:** component processes, local states in plain language, actions, and which actions synchronize;
   - **Claim:** the exact deadlock, safety, basic progress, or conditional progress property AnviLTS will check;
   - **Assumptions:** bounds, environmental behavior, fairness, failures, timeouts, and other simplifications that affect the result;
   - **Omissions and open questions:** relevant behavior deliberately excluded and anything not yet supported by evidence.
5. Read [references/lts-model.md](references/lts-model.md), construct the component JSON, optional safety monitor, and optional progress properties. Attach evidence to every transition. Prefer `code` evidence with repository-relative file and line references; use `user-stated`, `assumption`, `environment`, or `derived` evidence only when that is genuinely the basis for the transition. Add the model-wide abstraction ledger.
6. Call `validate_model`. Correct structural errors without changing domain meaning. Review `approvalAudit`: resolve uncited transitions, missing source revisions, and unresolved abstraction items. Never hide an audit warning. Convert a user-accepted uncertainty into an explicit assumption instead of leaving it unresolved.
7. Present the exact model for approval in a compact evidence table: component, source state, action, target state, evidence, and plain-language meaning. Separately list synchronization, the property, source revision, assumptions, omissions, bounds, fairness, and any accepted non-code evidence. Ask explicitly whether this abstraction accurately represents the behavior and risk to check. Invite corrections. Do not treat a generic acknowledgment as approval while material details remain ambiguous.
8. Do not call `verify_lts` until the user approves the evidence-backed model. If the user explicitly requests a provisional run, label it provisional and retain every audit warning in the result. After approval, call `verify_lts` and report the checked property, explored-state counts, assumptions/bounds, and shortest counterexample when one exists. For progress, report that LTSA fair-choice semantics were used and distinguish the finite prefix from the recurrent terminal component. Say, "The property is satisfied by this model under these assumptions," never, "the code is proven safe."
9. Map every reported counterexample step back to its returned evidence. If source has changed since the recorded revision, stop and regenerate the model instead of presenting stale line references.
10. When verification finds a deadlock, ERROR state, safety-property violation, or progress violation, explain the result and offer to visualize it. For progress, explain which actions recur and which required progress actions are absent. Do not call `render_lts` until the user agrees.
11. If the user accepts the visualization offer, call `render_lts` with the same machines, the safety property when applicable, and the exact trace returned by `verify_lts`. For progress, also pass the returned `terminalStates` as `highlightStates`. Present the resulting graph and briefly map the highlighted path or recurrent region back to the relevant code behavior. Do not reconstruct or alter the diagnostic for presentation.

## Modeling Discipline

- Derive transitions from source evidence and confirmed behavior; do not invent happy-path recovery or fairness.
- Cite every transition. A citation explains why the edge exists, not merely where an action name appears. Use multiple evidence entries when synchronization or behavior spans several locations.
- Treat provenance as semantically neutral: evidence never changes reachability, synchronization, or a verdict.
- Keep the abstraction ledger honest. Transition citations do not prove that omitted behavior was modeled.
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
- Counterexample transitions retain their provenance. Use it to explain which source behavior supports each step and which property rule was violated.
- A passing result covers only reachable behavior represented by the model and its stated bounds.
