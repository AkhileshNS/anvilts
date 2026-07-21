# AnviLTS

## Current Product Shape

AnviLTS is delivered as a portable local MCP server plus a Codex plugin rather than as a hosted chatbot. MCP-compatible agents can call the verification engine directly. The Codex plugin adds repository context, the domain modeling workflow, and human approval without a hosted LLM backend, BYOK flow, or source-upload surface.

The primary hackathon flow is: inspect code in an agent, confirm the abstraction, call the local LTS engine, and return a reproducible counterexample plus an optional SVG graph.

## Idea

AnviLTS is a conversational formal-verification tool for concurrent
systems. It combines an LLM with a deterministic labelled-transition-system
(LTS) analysis engine so that engineers can model and check concurrent designs
without first learning a formal specification language such as FSP.

The LLM helps the user describe, clarify, and visualize a system. The analysis
engine—not the LLM—composes the resulting state machines, explores their
reachable states, checks explicitly stated properties, and returns concrete
counterexamples when a property is violated.

## Problem

Formal tools such as LTSA can expose deadlocks, unsafe behavior, and progress
violations that are difficult to discover through conventional testing. Their
adoption is limited, however, by the expertise required to translate a system
design into a correct formal specification.

FSP makes labelled transition systems more concise to describe, but writing a
faithful FSP model remains a specialized skill. An incorrect or incomplete model
can be verified successfully while failing to represent the real system.

AnviLTS addresses the modeling barrier by making the construction of the formal
model a collaborative conversation rather than a code-authoring exercise.

## Product Thesis

An LLM is well suited to eliciting requirements, identifying ambiguity, and
explaining formal results. It is not a trustworthy verification engine.

AnviLTS therefore assigns each part of the system a clear responsibility:

- The user supplies domain knowledge and approves the model and properties.
- The LLM acts as a modeling partner. It inspects relevant code, asks clarifying
  questions, constructs the model, suggests properties, and explains results.
- The LTS engine is the source of truth for composition, state exploration,
  property checking, and counterexample generation.

The product must never reduce verification to an unsupported LLM assertion.
Every result must be backed by an inspectable model, explicit properties, and
deterministic engine output.

## Intended Workflow

1. **Inspect** — The agent reads the relevant implementation and the user
   explains the behavior or failure they want to check.
2. **Clarify** — The agent identifies missing or ambiguous behavior and asks
   targeted questions.
3. **Model** — The LLM constructs individual state machines for the system's
   components.
4. **Review** — The agent exposes the component states, transitions, shared
   actions, bounds, and assumptions for explicit user approval.
5. **Specify** — The LLM asks what the user wants to verify and helps express
   those requirements as precise properties.
6. **Compose** — The engine composes the component state machines into the
   reachable behavior of the system.
7. **Verify** — The engine checks the selected properties.
8. **Explain** — AnviLTS presents a successful result or maps a counterexample
   trace back onto the implementation in language the user can understand.
9. **Refine** — The user and LLM adjust the design or property and run the check
   again.

## Semantic Model and Visualization

Any visualization is derived from the semantic state-machine data consumed by
the verification engine. A graph is an inspectable view of the model, never a
separate picture that must be reinterpreted by the LLM.

This prevents a translation gap in which a user approves one design visually
but the engine verifies a different interpretation.

A component state machine will initially resemble:

```json
{
  "name": "coin",
  "alphabet": ["tau", "toss", "heads", "tails"],
  "initial": 0,
  "transitions": [
    { "from": 0, "action": "toss", "to": 1 },
    { "from": 0, "action": "toss", "to": 2 },
    { "from": 1, "action": "heads", "to": 0 },
    { "from": 2, "action": "tails", "to": 0 }
  ]
}
```

The schema must remain inspectable, editable, serializable, and validated at
the boundary between the agent, optional visualization, and engine.

## Engine Direction

The engine is implemented in TypeScript so the same core can serve the CLI,
the local MCP server, parity tests, and future integrations.

It will reconstruct the essential LTSA analysis pipeline rather than invoke the
FSP compiler:

- Accept individual labelled state machines directly.
- Preserve nondeterministic behavior.
- Compose component machines according to explicit synchronization rules.
- Explore reachable composite states.
- Check safety and other supported behavioral properties.
- Produce reproducible counterexample traces.
- Expose sufficient intermediate data for visualization and explanation.

FSP is not part of the user workflow or required as an intermediate format.
AnviLTS replaces the FSP authoring layer while retaining the proven idea of
finite-state, exhaustive analysis.

## Verification Boundary

AnviLTS verifies properties of the approved model; it does not automatically
prove that a deployed implementation is safe.

Results should use precise language such as:

> The selected property is satisfied by this model under the listed
> assumptions.

The product should disclose:

- The component machines and their transitions.
- The properties that were checked.
- Assumptions introduced during modeling.
- Bounds or abstractions used to keep the state space finite.
- Unresolved ambiguities.
- The engine result and any counterexample trace.

## Initial MVP

The first useful version should:

- Represent and validate component state machines in TypeScript.
- Compose multiple machines using LTSA-compatible action synchronization.
- Enumerate the reachable composite state space.
- Detect at least deadlocks and safety-property violations.
- Return minimal, understandable counterexample traces.
- Demonstrate a broken concurrent design, explain its failure, apply a change,
  and verify the revised model.

The MCP workflow and optional visual clients remain presentation layers over
the verified engine rather than substitutes for it.

## Differentiation

AnviLTS is not a chatbot that writes FSP and reports success. Its differentiator
is an evidence-first workflow in which:

- Natural conversation and repository inspection produce an executable model.
- The user verifies the model before verification begins.
- A deterministic engine checks the actual model shown to the user.
- Counterexamples are explained and replayed visually.
- Every conclusion remains connected to its model, property, assumptions, and
  engine evidence.

## Current Non-Goals

- Proving arbitrary source-code implementations equivalent to their models.
- Verifying unbounded or infinite-state systems without abstraction.
- Treating an LLM-generated model as correct without user review.
- Reimplementing the entire FSP language or its compiler.
- Claiming that a successful model check guarantees production-system safety.

## Open Design Questions

- Exact state-machine and property schemas.
- Composition and synchronization semantics.
- Treatment of internal `tau` actions.
- Error-state and property-automaton representation.
- Search strategy and counterexample minimization.
- State-space limits and abstraction support.
- Portable packaging and discovery across MCP clients.
- Interactive MCP UI support without slowing verification-only calls.
- The boundary between deterministic engine logic and agent tool calls.
