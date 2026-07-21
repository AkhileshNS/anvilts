import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { composeStateMachines } from "../src/compose.ts";
import { analyzeProgress, parseProgressProperty } from "../src/progress.ts";
import { monitorProperty } from "../src/property.ts";
import { detectDeadlocks } from "../src/reachability.ts";
import {
  parseStateMachine,
  type StateMachine,
} from "../src/state-machine.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CASES_DIR = join(HERE, "cases");

type Verdict =
  | "deadlock"
  | "no deadlock"
  | "property violation"
  | "no property violation"
  | "progress violation"
  | "no progress violation";

const DEADLOCK_VERDICTS = new Set<Verdict>(["deadlock", "no deadlock"]);
const SAFETY_VERDICTS = new Set<Verdict>([
  "property violation",
  "no property violation",
]);
const PROGRESS_VERDICTS = new Set<Verdict>([
  "progress violation",
  "no progress violation",
]);

interface CaseIndexEntry {
  name: string;
  file: string;
}

interface CaseIndex {
  count: number;
  cases: CaseIndexEntry[];
}

interface ExpectedComposite {
  states: number;
  transitions: number;
}

interface ParityCase {
  name: string;
  inputs: unknown[];
  property?: unknown;
  progress?: unknown[];
  output: Verdict;
  meta: {
    source: string;
    process: string;
    componentCount: number;
    exactCounts?: boolean;
    expectedComposite: ExpectedComposite | null;
    deadlockTrace?: string[];
    violationTrace?: string[];
    terminalSetActions?: string[];
    prefixTrace?: string[];
    cycleTrace?: string[];
  };
}

interface CaseResult {
  name: string;
  passed: boolean;
  durationMs: number;
  expected: Verdict;
  actual?: Verdict;
  states?: number;
  transitions?: number;
  issues: string[];
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseIndex(value: unknown): CaseIndex {
  if (
    typeof value !== "object" ||
    value === null ||
    !("cases" in value) ||
    !Array.isArray(value.cases)
  ) {
    throw new Error("Parity index must contain a cases array.");
  }

  const cases = value.cases.map((entry, index) => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("name" in entry) ||
      typeof entry.name !== "string" ||
      !("file" in entry) ||
      typeof entry.file !== "string"
    ) {
      throw new Error(`Parity index entry ${index} is invalid.`);
    }

    return { name: entry.name, file: entry.file };
  });

  return {
    count: "count" in value && typeof value.count === "number"
      ? value.count
      : cases.length,
    cases,
  };
}

function parseCase(value: unknown, file: string): ParityCase {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${file} must contain an object.`);
  }

  const candidate = value as Partial<ParityCase>;

  if (typeof candidate.name !== "string") {
    throw new Error(`${file} has no valid name.`);
  }

  if (!Array.isArray(candidate.inputs) || candidate.inputs.length === 0) {
    throw new Error(`${file} must contain at least one input machine.`);
  }

  const isProgress = candidate.progress !== undefined;
  const isSafety = candidate.property !== undefined;

  if (isProgress && isSafety) {
    throw new Error(`${file} carries both a property and progress properties.`);
  }

  if (isProgress) {
    if (!Array.isArray(candidate.progress) || candidate.progress.length === 0) {
      throw new Error(`${file} must contain at least one progress property.`);
    }
    if (!PROGRESS_VERDICTS.has(candidate.output!)) {
      throw new Error(`${file} carries progress properties but a non-progress verdict.`);
    }
  } else if (isSafety) {
    if (!SAFETY_VERDICTS.has(candidate.output!)) {
      throw new Error(`${file} carries a property but a non-safety verdict.`);
    }
  } else if (!DEADLOCK_VERDICTS.has(candidate.output!)) {
    throw new Error(`${file} has no property/progress machine but a non-deadlock verdict.`);
  }

  if (typeof candidate.meta !== "object" || candidate.meta === null) {
    throw new Error(`${file} has no valid metadata.`);
  }

  return candidate as ParityCase;
}

function buildSystem(inputs: unknown[]): StateMachine {
  const machines = inputs.map(parseStateMachine);
  return machines.length === 1
    ? machines[0]!
    : composeStateMachines(machines);
}

async function runCase(entry: CaseIndexEntry): Promise<CaseResult> {
  const started = performance.now();
  const issues: string[] = [];
  let fixture: ParityCase | undefined;

  try {
    fixture = parseCase(
      await readJson(join(CASES_DIR, entry.file)),
      entry.file,
    );

    if (fixture.name !== entry.name) {
      issues.push(
        `index name ${JSON.stringify(entry.name)} does not match fixture name ` +
          JSON.stringify(fixture.name),
      );
    }

    if (fixture.inputs.length !== fixture.meta.componentCount) {
      issues.push(
        `fixture declares ${fixture.meta.componentCount} component(s) but contains ` +
          fixture.inputs.length,
      );
    }

    const system = buildSystem(fixture.inputs);

    let actual: Verdict;
    let states: number;
    let transitions: number;

    if (fixture.progress !== undefined) {
      // Progress / liveness case: analyze the composed system's reachable graph
      // for a terminal set (SCC) that starves the progress action set.
      const properties = fixture.progress.map(parseProgressProperty);
      const reachable = detectDeadlocks(system);
      states = reachable.states.length;
      transitions = reachable.transitions.length;

      const analysis = analyzeProgress(system, reachable, properties);
      actual = analysis.violations.length > 0
        ? "progress violation"
        : "no progress violation";

      if (actual !== fixture.output) {
        issues.push(`verdict: expected ${fixture.output}, received ${actual}`);
      }

      // Progress models are pre-filtered to faithfully composable ones, so the
      // reachable graph must match LTSA's composite counts exactly.
      if (fixture.meta.exactCounts !== false && fixture.meta.expectedComposite !== null) {
        if (states !== fixture.meta.expectedComposite.states) {
          issues.push(
            `states: expected ${fixture.meta.expectedComposite.states}, received ${states}`,
          );
        }

        if (transitions !== fixture.meta.expectedComposite.transitions) {
          issues.push(
            `transitions: expected ${fixture.meta.expectedComposite.transitions}, ` +
              `received ${transitions}`,
          );
        }
      }
    } else if (fixture.property !== undefined) {
      // Safety case: monitor the composed system with the authored property.
      const monitored = monitorProperty(system, parseStateMachine(fixture.property));
      const analysis = detectDeadlocks(monitored);
      actual = analysis.violations.length > 0
        ? "property violation"
        : "no property violation";
      states = analysis.states.length;
      transitions = analysis.transitions.length;

      if (actual !== fixture.output) {
        issues.push(`verdict: expected ${fixture.output}, received ${actual}`);
      }
      // The monitored product is not directly comparable to LTSA's composite
      // reachable counts, so only the verdict is asserted for safety cases.
    } else {
      // Deadlock case.
      const analysis = detectDeadlocks(system);
      actual = analysis.deadlocks.length > 0 ? "deadlock" : "no deadlock";
      states = analysis.states.length;
      transitions = analysis.transitions.length;

      if (actual !== fixture.output) {
        issues.push(`verdict: expected ${fixture.output}, received ${actual}`);
      }

      // Priority / minimization composites (exactCounts === false) cannot match
      // LTSA's reachable graph, so only their verdict is asserted.
      if (fixture.meta.exactCounts !== false && fixture.meta.expectedComposite !== null) {
        if (states !== fixture.meta.expectedComposite.states) {
          issues.push(
            `states: expected ${fixture.meta.expectedComposite.states}, received ${states}`,
          );
        }

        if (transitions !== fixture.meta.expectedComposite.transitions) {
          issues.push(
            `transitions: expected ${fixture.meta.expectedComposite.transitions}, ` +
              `received ${transitions}`,
          );
        }
      }

      const deadlockTrace = fixture.meta.deadlockTrace ?? [];

      if (
        fixture.output === "deadlock" &&
        deadlockTrace.length > 0 &&
        analysis.deadlocks.length > 0
      ) {
        const actualTraceLength = analysis.deadlocks[0]!.trace.length;

        if (actualTraceLength !== deadlockTrace.length) {
          issues.push(
            `shortest deadlock trace: expected ${deadlockTrace.length} ` +
              `step(s), received ${actualTraceLength}`,
          );
        }
      }
    }

    return {
      name: fixture.name,
      passed: issues.length === 0,
      durationMs: performance.now() - started,
      expected: fixture.output,
      actual,
      states,
      transitions,
      issues,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(message);

    return {
      name: fixture?.name ?? entry.name,
      passed: false,
      durationMs: performance.now() - started,
      expected: fixture?.output ?? "no deadlock",
      issues,
    };
  }
}

const index = parseIndex(await readJson(join(CASES_DIR, "index.json")));

if (index.count !== index.cases.length) {
  throw new Error(
    `Parity index declares ${index.count} case(s) but lists ${index.cases.length}.`,
  );
}

console.log(`Running ${index.cases.length} LTSA parity case(s)...\n`);

const results: CaseResult[] = [];

for (const entry of index.cases) {
  const result = await runCase(entry);
  results.push(result);

  const status = result.passed ? "PASS" : "FAIL";
  const details =
    result.actual === undefined
      ? ""
      : ` ${result.actual}, ${result.states} state(s), ` +
        `${result.transitions} transition(s)`;
  console.log(
    `${status} ${result.name}${details} (${result.durationMs.toFixed(1)} ms)`,
  );

  for (const issue of result.issues) {
    console.log(`     ${issue}`);
  }
}

const passed = results.filter((result) => result.passed).length;
const failed = results.length - passed;
const verdictsPassed = results.filter(
  (result) => result.actual === result.expected,
).length;
const graphMismatches = results.filter((result) =>
  result.issues.some(
    (issue) => issue.startsWith("states:") || issue.startsWith("transitions:"),
  ),
).length;
const durationMs = results.reduce((total, result) => total + result.durationMs, 0);

console.log("\n====================== parity summary ======================");
console.log(`Verdicts     : ${verdictsPassed}/${results.length}`);
console.log(`Full parity  : ${passed}/${results.length}`);
console.log(`Graph diffs  : ${graphMismatches}`);
console.log(`Failed cases : ${failed}`);
console.log(`Time         : ${durationMs.toFixed(1)} ms`);

if (failed > 0) {
  process.exitCode = 1;
}
