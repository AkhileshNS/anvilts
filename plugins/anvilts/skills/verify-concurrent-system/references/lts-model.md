# AnviLTS Model Reference

## Component schema

```json
{
  "name": "worker",
  "alphabet": ["tau", "request", "acquire", "release"],
  "initial": 0,
  "end": -1,
  "transitions": [
    { "from": 0, "action": "request", "to": 1 },
    { "from": 1, "action": "acquire", "to": 2 },
    { "from": 2, "action": "release", "to": 0 }
  ]
}
```

- `name`: unique, non-empty component name.
- `alphabet`: unique non-empty action names. Include every action in which this component participates, even when it is unavailable in some local states.
- `initial`: non-negative integer state. Tuple states and reserved `END`/`ERROR` states are accepted for generated products.
- `end`: omit or use `-1` for a non-terminating component; otherwise provide its designated terminating state.
- `transitions`: directed labelled edges. Multiple edges with the same source and action preserve nondeterminism.

States are identifiers, not event names. Give their meanings in the abstraction proposal.

## Parallel composition

- A non-`tau` action appearing in exactly one component alphabet is private and advances only that component.
- A non-`tau` action appearing in multiple alphabets synchronizes across all of those components. It is enabled only when every participant has at least one matching outgoing edge from its current state.
- `tau` is reserved for internal/silent work. It never synchronizes. Each enabled tau edge advances only its owning component.
- Composition explores reachable tuples only. Do not construct the Cartesian product manually.

## Termination

An omitted or `-1` end means the component is intended to continue. A composite END is derived from component ends; do not enumerate composite terminal tuples. A state with no outgoing transition is a deadlock unless it is END.

## Safety properties

A property is a passive deterministic non-terminating LTS:

```json
{
  "name": "mutual-exclusion",
  "alphabet": ["a.enter", "a.exit", "b.enter", "b.exit"],
  "initial": 0,
  "end": -1,
  "transitions": [
    { "from": 0, "action": "a.enter", "to": 1 },
    { "from": 0, "action": "b.enter", "to": 2 },
    { "from": 1, "action": "a.exit", "to": 0 },
    { "from": 2, "action": "b.exit", "to": 0 }
  ]
}
```

- Put every action relevant to the invariant in the property alphabet. System actions outside that alphabet are ignored by the monitor.
- Define allowed transitions only. AnviLTS completes each missing relevant action to `ERROR` and loops ERROR on every relevant action.
- The property must be deterministic for each `(state, action)` pair, non-terminating, and must not observe `tau`.
- Property actions must exist in the system alphabet.

## Progress properties

Progress is checked over infinite executions using LTSA's fair-choice assumption. Under fair choice, if a choice among transitions is encountered infinitely often, every transition in that choice occurs infinitely often. State this assumption when proposing the abstraction.

A basic progress property requires at least one listed action to occur infinitely often:

```json
{
  "name": "jobs-continue-completing",
  "type": "progress",
  "actions": ["job.completed", "job.rejected"]
}
```

A conditional progress property requires progress only when a condition action also occurs infinitely often:

```json
{
  "name": "accepted-jobs-make-progress",
  "type": "conditional-progress",
  "conditionActions": ["job.accepted"],
  "progressActions": ["job.completed", "job.rejected"]
}
```

- Every action must be observable, unique within its set, and present in the system alphabet. Do not use `tau` in progress properties.
- Basic progress fails when a reachable cyclic terminal component contains none of the listed actions.
- Conditional progress fails when a condition action recurs in such a component but no progress action does.
- Conditional progress does not express the per-request response property “every accepted job eventually completes.”
- A progress violation returns a shortest `prefixTrace` into the recurrent region, its `terminalStates`, its `recurringActions`, and the `missingProgressActions`.

## Tool sequence

1. `validate_model`: schema and semantic validation, safety-property completion, progress-action validation, shared-action summary.
2. `compose_lts`: reachable composition and optional full composite JSON.
3. `verify_lts`: deadlock/ERROR/safety/progress exploration and shortest diagnostic prefix.
4. `render_lts`: SVG graph. Pass the returned `trace`; also pass `property` for safety-property traces. For progress violations, pass `prefixTrace` as `trace` and `terminalStates` as `highlightStates`.

The default MCP state limit is 100,000 reachable states and may be set from 100 to 500,000 per call.
