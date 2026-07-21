/**
 * Generates AnviLTS parity test fixtures from the LTSA example corpus.
 *
 * Pipeline:
 *   1. Discover every `||COMPOSITE` process definition in the FSP corpus.
 *   2. Run the prebuilt `ltsp.jar` (a JSON-emitting LTSA build) in a JRE
 *      container to obtain, per composite, the post-relabel component LTSes
 *      (`-b compose -go`) and the authoritative safety verdict (`-c safety`).
 *   3. Convert the components into the AnviLTS engine schema and write one
 *      self-contained fixture per composite. The jar is the oracle; `output` is
 *      ground truth.
 *
 * Two fixture flavors are produced:
 *
 *   Deadlock (files without a `property`):
 *     { "name", "inputs": [<LTS>, ...], "output": "deadlock" | "no deadlock", "meta" }
 *
 *   Safety (files with a single, identifiable `property`):
 *     { "name", "inputs": [<system LTS>, ...], "property": <LTS>,
 *       "output": "property violation" | "no property violation", "meta" }
 *
 *   Progress / liveness (files with a literal `progress P = {..}` declaration):
 *     { "name", "inputs": [<system LTS>, ...], "progress": [{"name", "actions"}],
 *       "output": "progress violation" | "no progress violation", "meta" }
 *
 * The `property` LTS is the *authored* monitor: the jar's ERROR-completion
 * transitions are stripped so the engine's own `completeProperty` re-derives
 * them. Composites that use alphabet extension (`+{...}`) are skipped because
 * the jar's graph JSON omits alphabets. Progress fixtures isolate a single
 * property per file so `-c progress` reports that property's verdict alone.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  convertMachine,
  convertProperty,
  splitComposedGraph,
  type LtspGraph,
} from "./convert.ts";
import { parseStateMachine } from "../src/state-machine.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const LTSP_DIR =
  process.env.LTSP_DIR ??
  join(HERE, "..", "..", "playmachine-prep", "ltsp-extension");
const EXAMPLE_DIR = join(LTSP_DIR, "example");
const JAROUT_DIR = join(HERE, ".jarout");
const CASES_DIR = join(HERE, "cases");
const JRE_IMAGE = "eclipse-temurin:17-jre";

interface Job {
  id: string;
  /** POSIX path relative to LTSP_DIR, e.g. "example/chapter3_lts/maker_user.lts". */
  rel: string;
  process: string;
  source: string;
  hasProperty: boolean;
  hasEnd: boolean;
  hasAlphabetExtension: boolean;
  /** Composite (or a process it minimizes) is not faithfully composable: priority / minimization. */
  usesPriorityOrMinimization: boolean;
  propertyNames: string[];
}

interface Skip {
  id: string;
  reason: string;
}

function listLtsFiles(dir: string): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);

    if (entry.isDirectory()) {
      found.push(...listLtsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".lts")) {
      found.push(full);
    }
  }

  return found;
}

function toId(rel: string, process: string): string {
  return `${rel.replace(/^example\//, "").replace(/\.lts$/, "").replace(/[\/]/g, "__")}__${process}`
    .replace(/[^A-Za-z0-9_]+/g, "_");
}

/**
 * Composite process *definitions* (`||NAME = ...` / `||NAME(params) = ...`).
 * Requiring the `=` avoids matching operands inside a composition body.
 */
function compositeNames(content: string): string[] {
  const names = new Set<string>();

  for (const match of content.matchAll(
    /\|\|\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*=/g,
  )) {
    names.add(match[1]!);
  }

  return [...names];
}

function propertyNames(content: string): string[] {
  const names = new Set<string>();

  for (const match of content.matchAll(/\bproperty\s+([A-Za-z_][A-Za-z0-9_]*)/g)) {
    names.add(match[1]!);
  }

  return [...names];
}

/**
 * Returns the text of each composite definition (from its `||NAME` to the next
 * composite start). Used to detect the FSP priority operators `<<` / `>>`, which
 * LTSA applies during composition to prune transitions. The engine does not
 * model priority, so such composites cannot match LTSA's reachable counts.
 */
function compositeBodies(content: string): Map<string, string> {
  const bodies = new Map<string, string>();
  const starts: Array<{ name: string; index: number }> = [];

  for (const match of content.matchAll(
    /\|\|\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s*=/g,
  )) {
    starts.push({ name: match[1]!, index: match.index });
  }

  for (const [position, start] of starts.entries()) {
    const end = starts[position + 1]?.index ?? content.length;
    bodies.set(start.name, content.slice(start.index, end));
  }

  return bodies;
}

function planJobs(): Job[] {
  const jobs: Job[] = [];

  for (const file of listLtsFiles(EXAMPLE_DIR)) {
    const rel = posix.join("example", relative(EXAMPLE_DIR, file).split(sep).join("/"));
    const content = readFileSync(file, "utf8");
    const names = compositeNames(content);

    if (names.length === 0) {
      continue;
    }

    const bodies = compositeBodies(content);
    // `minimal` / `deterministic` request bisimulation reduction that propagates
    // through any composite referencing the reduced process, so treat it as file-wide.
    const fileMinimizes = /\bminimal\b|\bdeterministic\b/.test(content);
    const flags = {
      hasProperty: /\bproperty\b/.test(content),
      hasEnd: /\bEND\b/.test(content),
      hasAlphabetExtension: /\+\s*\{/.test(content),
      propertyNames: propertyNames(content),
    };

    for (const process of names) {
      const usesPriorityOrMinimization =
        fileMinimizes || /<<|>>/.test(bodies.get(process) ?? "");
      jobs.push({
        id: toId(rel, process),
        rel,
        process,
        source: rel,
        usesPriorityOrMinimization,
        ...flags,
      });
    }
  }

  return jobs;
}

function generateOracle(jobs: Job[]): void {
  rmSync(JAROUT_DIR, { recursive: true, force: true });
  mkdirSync(join(JAROUT_DIR, "data"), { recursive: true });

  const tsv = jobs.map((job) => `${job.id}\t${job.rel}\t${job.process}`).join("\n") + "\n";
  writeFileSync(join(JAROUT_DIR, "jobs.tsv"), tsv, "utf8");

  const script = [
    "#!/usr/bin/env bash",
    "set -u",
    "JAR=/work/ltsp.jar",
    'while IFS=$\'\\t\' read -r id rel proc; do',
    '  [ -z "$id" ] && continue',
    '  d="/out/data/$id"',
    '  mkdir -p "$d"',
    '  lts="/work/$rel"',
    '  timeout 120 java -jar "$JAR" "$lts" -b compose -p "$proc" -go "$d/machines.json" > "$d/compose.txt" 2>&1',
    '  echo "compose_exit=$?" > "$d/status"',
    '  timeout 120 java -jar "$JAR" "$lts" -c safety -p "$proc" -go "$d/safety_graph.json" > "$d/safety.txt" 2>&1',
    '  echo "safety_exit=$?" >> "$d/status"',
    "done < /out/jobs.tsv",
    'echo "oracle-complete"',
    "",
  ].join("\n");
  writeFileSync(join(JAROUT_DIR, "run.sh"), script, "utf8");

  console.log(`Running ltsp.jar over ${jobs.length} composite(s) in ${JRE_IMAGE} ...`);
  const result = spawnSync(
    "docker",
    ["run", "--rm", "-v", `${LTSP_DIR}:/work`, "-v", `${JAROUT_DIR}:/out`, JRE_IMAGE, "bash", "/out/run.sh"],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(`Oracle generation failed (docker exit ${result.status}).`);
  }
}

function readStatus(dataDir: string): Record<string, string> {
  const status: Record<string, string> = {};
  const file = join(dataDir, "status");

  if (existsSync(file)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const [key, value] = line.split("=");
      if (key && value !== undefined) {
        status[key.trim()] = value.trim();
      }
    }
  }

  return status;
}

type VerdictKind = "deadlock" | "property-violation" | "holds" | "other";

interface Verdict {
  kind: VerdictKind;
  property?: string;
  trace: string[];
}

function traceAfter(text: string, headerPattern: RegExp): string[] {
  const trace: string[] = [];
  let capture = false;

  for (const line of text.split("\n")) {
    if (headerPattern.test(line)) {
      capture = true;
      continue;
    }

    if (capture) {
      if (/^\t/.test(line)) {
        trace.push(line.trim());
      } else {
        break;
      }
    }
  }

  return trace;
}

function parseVerdict(text: string): Verdict {
  const violation = /Trace to property violation in ([A-Za-z_][A-Za-z0-9_]*)/.exec(text);

  if (violation) {
    return {
      kind: "property-violation",
      property: violation[1]!,
      trace: traceAfter(text, /Trace to property violation/),
    };
  }

  if (/No deadlocks\/errors/.test(text)) {
    return { kind: "holds", trace: [] };
  }

  if (/Trace to DEADLOCK/.test(text)) {
    return { kind: "deadlock", trace: traceAfter(text, /Trace to DEADLOCK/) };
  }

  return { kind: "other", trace: [] };
}

function parseCounts(text: string): { states: number; transitions: number } | null {
  const match = /-- States:\s*(\d+)\s*Transitions:\s*(\d+)/.exec(text);
  return match ? { states: Number(match[1]), transitions: Number(match[2]) } : null;
}

interface IndexEntry {
  name: string;
  file: string;
  category: "deadlock" | "safety" | "progress";
  output: string;
  source: string;
  process: string;
}

function buildCases(jobs: Job[]): { skips: Skip[]; index: IndexEntry[] } {
  rmSync(CASES_DIR, { recursive: true, force: true });
  mkdirSync(CASES_DIR, { recursive: true });

  const skips: Skip[] = [];
  const index: IndexEntry[] = [];

  for (const job of jobs) {
    const dataDir = join(JAROUT_DIR, "data", job.id);
    const machinesFile = join(dataDir, "machines.json");
    const status = readStatus(dataDir);

    if (status["compose_exit"] !== "0" || !existsSync(machinesFile)) {
      skips.push({ id: job.id, reason: `jar compose failed (exit ${status["compose_exit"] ?? "?"})` });
      continue;
    }

    if (job.hasAlphabetExtension) {
      skips.push({ id: job.id, reason: "uses alphabet extension +{...} (alphabet not recoverable)" });
      continue;
    }

    const machinesRaw = readFileSync(machinesFile, "utf8");
    const verdict = parseVerdict(readFileSync(join(dataDir, "safety.txt"), "utf8"));
    const counts = parseCounts(readFileSync(join(dataDir, "compose.txt"), "utf8"));

    let graph: LtspGraph;
    try {
      graph = JSON.parse(machinesRaw) as LtspGraph;
    } catch (error) {
      skips.push({ id: job.id, reason: `invalid machines JSON: ${String(error)}` });
      continue;
    }

    const { components } = splitComposedGraph(graph, job.process);

    if (components.length === 0) {
      skips.push({ id: job.id, reason: "no component machines emitted" });
      continue;
    }

    if (job.hasProperty) {
      const entry = buildSafetyCase(job, components, verdict, counts, skips);
      if (entry) index.push(entry);
      continue;
    }

    const entry = buildDeadlockCase(job, components, machinesRaw, verdict, counts, skips);
    if (entry) index.push(entry);
  }

  return { skips, index };
}

/** Writes the unified fixture index across all categories. */
function writeIndex(index: IndexEntry[]): void {
  const sorted = [...index].sort((a, b) => a.name.localeCompare(b.name));
  writeFileSync(
    join(CASES_DIR, "index.json"),
    JSON.stringify(
      {
        count: sorted.length,
        deadlock: sorted.filter((entry) => entry.category === "deadlock").length,
        safety: sorted.filter((entry) => entry.category === "safety").length,
        progress: sorted.filter((entry) => entry.category === "progress").length,
        cases: sorted,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

function buildDeadlockCase(
  job: Job,
  components: LtspGraph["machines"],
  machinesRaw: string,
  verdict: Verdict,
  counts: { states: number; transitions: number } | null,
  skips: Skip[],
): IndexEntry | undefined {
  if (job.hasEnd) {
    skips.push({ id: job.id, reason: "uses END (termination vs deadlock ambiguous)" });
    return undefined;
  }

  if (/tau\(/.test(machinesRaw)) {
    skips.push({ id: job.id, reason: "component contains ERROR state (tau(-1))" });
    return undefined;
  }

  const output = verdict.kind === "deadlock" ? "deadlock" : verdict.kind === "holds" ? "no deadlock" : null;

  if (output === null) {
    skips.push({ id: job.id, reason: `unexpected verdict for deadlock case (${verdict.kind})` });
    return undefined;
  }

  let inputs;
  try {
    inputs = components.map((machine) => parseStateMachine(convertMachine(machine)));
  } catch (error) {
    skips.push({ id: job.id, reason: `conversion failed: ${String(error)}` });
    return undefined;
  }

  // Priority / minimization change LTSA's reachable graph but not (here) the
  // deadlock verdict; mark counts as non-exact so the runner checks verdict only.
  const exactCounts = !job.usesPriorityOrMinimization;
  const fixture = {
    name: job.id,
    inputs,
    output,
    meta: {
      category: "deadlock",
      source: job.source,
      process: job.process,
      componentCount: inputs.length,
      exactCounts,
      expectedComposite: counts,
      deadlockTrace: verdict.kind === "deadlock" ? verdict.trace : [],
    },
  };

  const file = `${job.id}.json`;
  writeFileSync(join(CASES_DIR, file), JSON.stringify(fixture, null, 2) + "\n", "utf8");
  return { name: job.id, file, category: "deadlock", output, source: job.source, process: job.process };
}

function buildSafetyCase(
  job: Job,
  components: LtspGraph["machines"],
  verdict: Verdict,
  counts: { states: number; transitions: number } | null,
  skips: Skip[],
): IndexEntry | undefined {
  const propertyNameSet = new Set(job.propertyNames);
  const propertyComponents = components.filter((machine) => propertyNameSet.has(machine.key));
  const systemComponents = components.filter((machine) => !propertyNameSet.has(machine.key));

  if (propertyComponents.length !== 1) {
    skips.push({
      id: job.id,
      reason: `not exactly one identifiable property component (found ${propertyComponents.length})`,
    });
    return undefined;
  }

  if (systemComponents.length === 0) {
    skips.push({ id: job.id, reason: "no system components alongside property" });
    return undefined;
  }

  const propertyComponent = propertyComponents[0]!;
  let output: "property violation" | "no property violation";

  if (verdict.kind === "holds") {
    output = "no property violation";
  } else if (verdict.kind === "property-violation" && verdict.property === propertyComponent.key) {
    output = "property violation";
  } else {
    skips.push({
      id: job.id,
      reason: `property-file verdict not a clean property outcome (${verdict.kind}${
        verdict.property ? ` in ${verdict.property}` : ""
      })`,
    });
    return undefined;
  }

  let inputs;
  let property;
  try {
    inputs = systemComponents.map((machine) => parseStateMachine(convertMachine(machine)));
    property = parseStateMachine(convertProperty(propertyComponent));
  } catch (error) {
    skips.push({ id: job.id, reason: `conversion failed: ${String(error)}` });
    return undefined;
  }

  const fixture = {
    name: job.id,
    inputs,
    property,
    output,
    meta: {
      category: "safety",
      source: job.source,
      process: job.process,
      propertyName: propertyComponent.key,
      componentCount: inputs.length,
      expectedComposite: counts,
      violationTrace: output === "property violation" ? verdict.trace : [],
    },
  };

  const file = `${job.id}.json`;
  writeFileSync(join(CASES_DIR, file), JSON.stringify(fixture, null, 2) + "\n", "utf8");
  return { name: job.id, file, category: "safety", output, source: job.source, process: job.process };
}

// ===========================================================================
// Progress (liveness) phase
//
// A `progress P = {a, b}` declaration asserts that on every infinite execution
// at least one action of P occurs infinitely often. LTSA (fair-choice) reports
// a violation when a *terminal set of states* (a terminal strongly-connected
// component the system can be trapped in) contains no action of P.
//
// We generate one fixture per (composable target, single literal progress
// property): the original file is stripped of all `progress` lines and given
// exactly the property under test, so `-c progress` yields that property's
// verdict in isolation. Only literal action sets on faithfully composable
// targets are emitted; indexed/parameterised sets and priority/minimising or
// alphabet-extending models are skipped (consistent with the other phases).
// ===========================================================================

interface ProgressProperty {
  name: string;
  actions: string[];
}

interface ProgressJob {
  id: string;
  rel: string;
  source: string;
  target: string;
  isComposite: boolean;
  property: ProgressProperty;
  /** Isolated FSP: original content minus every `progress` line, plus this one. */
  ltsContent: string;
}

/** `progress NAME = {a, b, ...}` with a purely literal action set. */
function literalProgressProperties(content: string): ProgressProperty[] {
  const properties: ProgressProperty[] = [];

  for (const match of content.matchAll(
    /^[ \t]*progress[ \t]+([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*\{([^}]*)\}[ \t]*$/gm,
  )) {
    const actions = match[2]!
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    // Literal action names only: lowercase-initial, no ranges/indices/set refs.
    const literal =
      actions.length > 0 && actions.every((action) => /^[a-z][A-Za-z0-9_.]*$/.test(action));

    if (literal) {
      properties.push({ name: match[1]!, actions });
    }
  }

  return properties;
}

/** Top-level primitive process heads (`NAME = ...`), excluding indexed sub-states. */
function topLevelProcessHeads(content: string): string[] {
  const names = new Set<string>();

  for (const match of content.matchAll(/^([A-Z][A-Za-z0-9_]*)[ \t]*=/gm)) {
    names.add(match[1]!);
  }

  return [...names];
}

function stripProgressLines(content: string): string {
  return content
    .split("\n")
    .filter((line) => !/^[ \t]*progress\b/.test(line))
    .join("\n");
}

function planProgressJobs(): ProgressJob[] {
  const jobs: ProgressJob[] = [];

  for (const file of listLtsFiles(EXAMPLE_DIR)) {
    const rel = posix.join("example", relative(EXAMPLE_DIR, file).split(sep).join("/"));
    const content = readFileSync(file, "utf8");

    const properties = literalProgressProperties(content);
    if (properties.length === 0) {
      continue;
    }

    // Skip models the engine cannot faithfully reproduce: priority (`<<`/`>>`),
    // bisimulation minimisation, and alphabet extension (`+{...}` or `) + Set`).
    if (/<<|>>/.test(content)) continue;
    if (/\bminimal\b|\bdeterministic\b/.test(content)) continue;
    if (/\+\s*\{/.test(content) || /\)\s*\+/.test(content)) continue;

    const composites = compositeNames(content);
    let targets: Array<{ name: string; isComposite: boolean }>;

    if (composites.length > 0) {
      targets = composites.map((name) => ({ name, isComposite: true }));
    } else {
      const heads = topLevelProcessHeads(content);
      // Only a single, unambiguous primitive process can stand in for DEFAULT.
      if (heads.length !== 1) continue;
      targets = [{ name: heads[0]!, isComposite: false }];
    }

    const stripped = stripProgressLines(content);

    for (const target of targets) {
      for (const property of properties) {
        const id = `${toId(rel, target.name)}__${property.name}`;
        const ltsContent = `${stripped}\nprogress ${property.name} = {${property.actions.join(",")}}\n`;
        jobs.push({
          id,
          rel,
          source: rel,
          target: target.name,
          isComposite: target.isComposite,
          property,
          ltsContent,
        });
      }
    }
  }

  return jobs;
}

const PROGRESS_DIR = join(JAROUT_DIR, "progress");

function generateProgressOracle(jobs: ProgressJob[]): void {
  mkdirSync(PROGRESS_DIR, { recursive: true });

  for (const job of jobs) {
    writeFileSync(join(PROGRESS_DIR, `${job.id}.lts`), job.ltsContent, "utf8");
  }

  const tsv = jobs.map((job) => `${job.id}\t${job.target}`).join("\n") + "\n";
  writeFileSync(join(PROGRESS_DIR, "jobs.tsv"), tsv, "utf8");

  const script = [
    "#!/usr/bin/env bash",
    "set -u",
    "JAR=/work/ltsp.jar",
    'while IFS=$\'\\t\' read -r id proc; do',
    '  [ -z "$id" ] && continue',
    '  d="/out/progress/$id"',
    '  mkdir -p "$d"',
    '  lts="/out/progress/$id.lts"',
    '  timeout 120 java -jar "$JAR" "$lts" -b compose -p "$proc" -go "$d/machines.json" > "$d/compose.txt" 2>&1',
    '  echo "compose_exit=$?" > "$d/status"',
    '  timeout 120 java -jar "$JAR" "$lts" -c progress -p "$proc" > "$d/progress.txt" 2>&1',
    '  echo "progress_exit=$?" >> "$d/status"',
    "done < /out/progress/jobs.tsv",
    'echo "progress-oracle-complete"',
    "",
  ].join("\n");
  writeFileSync(join(PROGRESS_DIR, "run.sh"), script, "utf8");

  console.log(`Running ltsp.jar progress checks over ${jobs.length} property job(s) ...`);
  const result = spawnSync(
    "docker",
    ["run", "--rm", "-v", `${LTSP_DIR}:/work`, "-v", `${JAROUT_DIR}:/out`, JRE_IMAGE, "bash", "/out/progress/run.sh"],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    throw new Error(`Progress oracle generation failed (docker exit ${result.status}).`);
  }
}

interface ProgressVerdict {
  kind: "holds" | "violation" | "other";
  property?: string;
  prefix: string[];
  cycle: string[];
  terminalActions: string[];
}

function parseActionSet(lines: string[]): string[] {
  const joined = lines.join(" ").trim();
  const inner = /^\{(.*)\}$/.exec(joined);
  const body = inner ? inner[1]! : joined;
  return body
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function parseProgressVerdict(text: string): ProgressVerdict {
  const violation = /Progress violation:\s*([A-Za-z_][A-Za-z0-9_]*)/.exec(text);

  if (violation) {
    return {
      kind: "violation",
      property: violation[1]!,
      prefix: traceAfter(text, /Trace to terminal set of states:/),
      cycle: traceAfter(text, /Cycle in terminal set:/),
      terminalActions: parseActionSet(traceAfter(text, /Actions in terminal set:/)),
    };
  }

  if (/No progress violations detected\./.test(text)) {
    return { kind: "holds", prefix: [], cycle: [], terminalActions: [] };
  }

  return { kind: "other", prefix: [], cycle: [], terminalActions: [] };
}

function buildProgressCases(jobs: ProgressJob[]): { skips: Skip[]; index: IndexEntry[] } {
  const skips: Skip[] = [];
  const index: IndexEntry[] = [];

  for (const job of jobs) {
    const dataDir = join(PROGRESS_DIR, job.id);
    const machinesFile = join(dataDir, "machines.json");
    const status = readStatus(dataDir);

    if (status["compose_exit"] !== "0" || status["progress_exit"] !== "0" || !existsSync(machinesFile)) {
      skips.push({ id: job.id, reason: `jar progress run failed (compose ${status["compose_exit"] ?? "?"}, progress ${status["progress_exit"] ?? "?"})` });
      continue;
    }

    const machinesRaw = readFileSync(machinesFile, "utf8");

    if (/tau\(/.test(machinesRaw)) {
      skips.push({ id: job.id, reason: "component contains ERROR state (tau(-1))" });
      continue;
    }

    let graph: LtspGraph;
    try {
      graph = JSON.parse(machinesRaw) as LtspGraph;
    } catch (error) {
      skips.push({ id: job.id, reason: `invalid machines JSON: ${String(error)}` });
      continue;
    }

    // The jar echoes the composed result as `-p` (a composite) or `DEFAULT`
    // (a bare process); the remaining machines are the parallel components.
    const excluded = new Set<string>(["DEFAULT"]);
    if (job.isComposite) excluded.add(job.target);
    const components = graph.machines.filter((machine) => !excluded.has(machine.key));

    if (components.length === 0) {
      skips.push({ id: job.id, reason: "no component machines emitted" });
      continue;
    }

    const verdict = parseProgressVerdict(readFileSync(join(dataDir, "progress.txt"), "utf8"));
    let output: "progress violation" | "no progress violation";

    if (verdict.kind === "holds") {
      output = "no progress violation";
    } else if (verdict.kind === "violation" && verdict.property === job.property.name) {
      output = "progress violation";
    } else {
      skips.push({
        id: job.id,
        reason: `unexpected progress verdict (${verdict.kind}${verdict.property ? ` in ${verdict.property}` : ""})`,
      });
      continue;
    }

    let inputs;
    try {
      inputs = components.map((machine) => parseStateMachine(convertMachine(machine)));
    } catch (error) {
      skips.push({ id: job.id, reason: `conversion failed: ${String(error)}` });
      continue;
    }

    // The engine validates that progress actions live in the composed system's
    // alphabet (union of components); drop fixtures that would violate that.
    const alphabet = new Set(inputs.flatMap((machine) => machine.alphabet));
    const missing = job.property.actions.filter((action) => !alphabet.has(action));
    if (missing.length > 0) {
      skips.push({ id: job.id, reason: `progress action(s) not in system alphabet: ${missing.join(", ")}` });
      continue;
    }

    const counts = parseCounts(readFileSync(join(dataDir, "compose.txt"), "utf8"));
    const fixture = {
      name: job.id,
      inputs,
      progress: [{ name: job.property.name, type: "progress", actions: job.property.actions }],
      output,
      meta: {
        category: "progress",
        source: job.source,
        process: job.target,
        propertyName: job.property.name,
        componentCount: inputs.length,
        exactCounts: true,
        expectedComposite: counts,
        terminalSetActions: verdict.terminalActions,
        prefixTrace: verdict.prefix,
        cycleTrace: verdict.cycle,
      },
    };

    const file = `${job.id}.json`;
    writeFileSync(join(CASES_DIR, file), JSON.stringify(fixture, null, 2) + "\n", "utf8");
    index.push({ name: job.id, file, category: "progress", output, source: job.source, process: job.target });
  }

  return { skips, index };
}

const jobs = planJobs();
generateOracle(jobs);
const { skips, index } = buildCases(jobs);

const progressJobs = planProgressJobs();
generateProgressOracle(progressJobs);
const { skips: progressSkips, index: progressIndex } = buildProgressCases(progressJobs);

const allIndex = [...index, ...progressIndex];
writeIndex(allIndex);
skips.push(...progressSkips);

console.log("\n==================== fixture generation ====================");
console.log(`Composites discovered : ${jobs.length}`);
console.log(`Progress jobs         : ${progressJobs.length}`);
console.log(`Fixtures emitted      : ${allIndex.length}`);
console.log(`  deadlock            : ${allIndex.filter((entry) => entry.category === "deadlock").length}`);
console.log(`  safety              : ${allIndex.filter((entry) => entry.category === "safety").length}`);
console.log(`  progress            : ${allIndex.filter((entry) => entry.category === "progress").length}`);
console.log(`Skipped               : ${skips.length}`);
console.log(`Cases directory       : ${CASES_DIR}`);

const byReason = new Map<string, number>();
for (const skip of skips) {
  const key = skip.reason.replace(/\(exit \d+\)/, "(exit N)").replace(/\(found \d+\)/, "(found N)");
  byReason.set(key, (byReason.get(key) ?? 0) + 1);
}
console.log("\nSkip reasons:");
for (const [reason, count] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${count.toString().padStart(3)}  ${reason}`);
}
