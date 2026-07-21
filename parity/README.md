# AnviLTS parity fixtures

LTSA-backed parity test cases for the AnviLTS engine. Each fixture is a set of
component LTSes plus the verdict the real LTSA tool produces. A runner feeds the
`inputs` (and, for safety cases the `property`, for liveness cases the
`progress` declarations) to the AnviLTS engine and checks that its verdict
matches `output`.

There are three flavors, distinguished by which extra field is present:
`property` (safety), `progress` (liveness), or neither (deadlock).
`cases/index.json` lists every fixture with its `category` and expected `output`.

## Deadlock fixtures (`cases/*.json`, no `property`)

```jsonc
{
  "name": "chapter6_lts__DiningPhilosophers__DINERS",
  "inputs": [ <StateMachine>, <StateMachine>, ... ], // component LTSes to compose
  "output": "deadlock" | "no deadlock",              // LTSA ground truth
  "meta": {
    "category": "deadlock",
    "source": "example/chapter6_lts/DiningPhilosophers.lts",
    "process": "DINERS",                              // the ||COMPOSITE analysed
    "componentCount": 10,
    "exactCounts": true,                              // false => verdict-only (see below)
    "expectedComposite": { "states": 7774, "transitions": 34240 }, // LTSA full compose
    "deadlockTrace": ["phil.0.sitdown", "phil.0.right.get", ...]    // LTSA trace ([] if none)
  }
}
```

## Safety fixtures (`cases/*.json`, with `property`)

```jsonc
{
  "name": "chapter7_lts__Mutex_property__CHECK",
  "inputs": [ <StateMachine>, ... ],   // SYSTEM component LTSes (property excluded)
  "property": <StateMachine>,          // authored safety monitor (no ERROR transitions)
  "output": "property violation" | "no property violation",
  "meta": {
    "category": "safety",
    "source": "example/chapter7_lts/Mutex_property.lts",
    "process": "CHECK",
    "propertyName": "MUTEX",
    "componentCount": 4,
    "expectedComposite": { "states": 10, "transitions": 12 },
    "violationTrace": []               // LTSA trace to the violation ([] if it holds)
  }
}
```

The `property` machine is the *authored* monitor: LTSA's ERROR-completion
transitions are stripped, so the engine's `completeProperty` re-derives the
`ERROR` sink from the alphabet. System components may legitimately contain their
own `ERROR` states (e.g. a bounded semaphore); those are kept and are
unreachable in `no property violation` cases. Safety fixtures assert the verdict
only — the monitored product is not directly comparable to LTSA's composite
counts.

## Progress / liveness fixtures (`cases/*.json`, with `progress`)

```jsonc
{
  "name": "chapter7_lts__Twocoin__RUN__TAILS",
  "inputs": [ <StateMachine>, ... ],   // system component LTSes to compose
  "progress": [                        // progress declarations checked together
    { "name": "TAILS", "type": "progress", "actions": ["tails"] }
  ],
  "output": "progress violation" | "no progress violation",
  "meta": {
    "category": "progress",
    "source": "example/chapter7_lts/Twocoin.lts",
    "process": "RUN",                  // the target (||COMPOSITE, or a bare process)
    "propertyName": "TAILS",
    "componentCount": 1,
    "exactCounts": true,
    "expectedComposite": { "states": 6, "transitions": 8 }, // LTSA full compose
    "terminalSetActions": ["heads", "toss"], // actions recurring in LTSA's terminal set
    "prefixTrace": ["pick"],           // LTSA trace to the terminal set ([] if none)
    "cycleTrace": ["toss", "heads"]    // LTSA cycle within the terminal set ([] if none)
  }
}
```

A `progress P = {a, b}` declaration asserts that on every infinite (fair-choice)
execution at least one action of `P` occurs infinitely often. LTSA reports a
violation when a *terminal set of states* (a terminal strongly-connected
component the system can be trapped in) contains no action of `P`. Each fixture
isolates a **single** literal progress property: the source file is stripped of
all `progress` lines and given exactly that one, so `-c progress` returns that
property's verdict alone. Only literal action sets whose actions all live in the
composed system alphabet are emitted; indexed/parameterised sets
(`progress W[i:1..N] = ...`) and priority/minimising/alphabet-extending models
are skipped. These are faithfully composable, so `exactCounts` is always `true`.

Each `StateMachine` follows the engine schema (`src/state-machine.ts`):
`{ name, alphabet, initial, end, transitions }`, numeric state ids, `end: -1`.

### `exactCounts`

Composites that use FSP priority (`<<` / `>>`) or `minimal` / `deterministic`
minimization are marked `exactCounts: false`. LTSA prunes/reduces the graph for
these, so the engine (which models neither) cannot match the reachable
state/transition counts; the runner asserts only their verdict.

## Running the parity suite

Run every committed fixture against the current AnviLTS engine:

```bash
npm run parity
```

The runner checks every fixture's verdict and, for deadlock cases with
`exactCounts !== false`, the reachable state/transition counts and shortest
deadlock trace length. It exits nonzero if any case differs from LTSA.

### Runner contract

Build the system: `inputs.length >= 2` → `composeStateMachines(inputs)`;
`=== 1` → use it directly.

- Deadlock case (no `property`/`progress`): `detectDeadlocks(system).deadlocks.length > 0`
  → `"deadlock"`, else `"no deadlock"`.
- Safety case (has `property`): `monitorProperty(system, property)` then
  `detectDeadlocks(...)`; `violations.length > 0` → `"property violation"`, else
  `"no property violation"`.
- Progress case (has `progress`): parse each entry with `parseProgressProperty`,
  then `analyzeProgress(system, detectDeadlocks(system), properties)`;
  `violations.length > 0` → `"progress violation"`, else `"no progress violation"`.
  The composed reachable counts are asserted against `meta.expectedComposite`
  (progress fixtures are always `exactCounts: true`).

Optionally cross-check counts against `meta.expectedComposite` (deadlock and
progress cases with `exactCounts !== false`) and traces against
`meta.deadlockTrace` / `meta.violationTrace` (LTSA reports one shortest trace;
prefer comparing length + replay validity over exact equality).

## Regenerating

Fixtures are produced from the FSP corpus in the `ltsp-extension` repo using its
prebuilt `ltsp.jar` (a JSON-emitting LTSA build) as the oracle:

```bash
# requires Docker (pulls eclipse-temurin:17-jre) and the ltsp-extension repo
LTSP_DIR=/path/to/ltsp-extension node parity/gen-cases.ts
```

`gen-cases.ts` discovers every `||COMPOSITE` definition, runs `ltsp.jar`
(`-b compose -go` for component LTSes, `-c safety` for the verdict), converts
the components via `convert.ts`, and writes the fixtures. It then runs a second
progress pass: for each faithfully composable target and each literal
`progress` property, it writes an isolated single-property FSP file, runs
`-c progress`, and emits the liveness fixture.

## Scope and exclusions

Deadlock, safety (`property` monitor), and progress (`progress` declaration)
categories are emitted. A composite is skipped when it cannot be faithfully
represented in the current engine schema:

| Skip reason | Applies to | Why |
| --- | --- | --- |
| ERROR state (`tau(-1)`) | deadlock | A non-property component reaches an LTSA ERROR sink (e.g. bounded semaphore overflow); out of scope for deadlock fixtures. |
| alphabet extension `+{...}` | both | The jar's graph JSON omits alphabets, so blocking-only actions can't be recovered. |
| `END` | deadlock | The jar renders END and STOP identically (`"on": {}`); the engine can't tell termination from deadlock. |
| no single identifiable property | safety | The composite has zero or multiple `property` components, so a single monitor can't be isolated. |
| non-clean property verdict | safety | LTSA reports a deadlock or a non-property ERROR (e.g. a bounded lock) rather than a clean hold/violation of the property. |
| non-literal `progress` set | progress | Indexed/parameterised sets (`progress W[i:1..N] = ...`) or set-constant references can't be expanded to concrete actions here. |
| progress action not in alphabet | progress | A literal progress action is absent from the composed system alphabet (e.g. hidden to `tau`), which the engine rejects. |

Composites using priority (`<<` / `>>`) or `minimal` / `deterministic` are kept
(for deadlock/safety) but marked `exactCounts: false` (verdict-only), since
LTSA's graph reduction is not reproducible by the engine. For progress, whole
files using priority, minimization, or alphabet extension are skipped.
