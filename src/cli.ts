import { readFile } from "node:fs/promises";
import { Command } from "commander";

import { composeStateMachines } from "./compose.ts";
import { monitorProperty } from "./property.ts";
import {
  detectDeadlocks,
  type ReachabilityResult,
} from "./reachability.ts";
import {
  analyzeProgress,
  parseProgressProperty,
  type ProgressAnalysis,
  type ProgressProperty,
} from "./progress.ts";
import {
  parseStateMachineJson,
  type State,
  type StateMachine,
} from "./state-machine.ts";

function collectPath(path: string, paths: string[] | undefined): string[] {
  return [...(paths ?? []), path];
}

function parseProcessNames(value: string): string[] {
  return value
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

async function loadStateMachine(path: string): Promise<StateMachine> {
  try {
    const contents = await readFile(path, "utf8");
    return parseStateMachineJson(contents);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: ${message}`);
  }
}

async function loadProgressProperty(path: string): Promise<ProgressProperty> {
  try {
    const contents = await readFile(path, "utf8");
    return parseProgressProperty(JSON.parse(contents));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${path}: ${message}`);
  }
}

function formatState(state: State): string {
  return JSON.stringify(state);
}

function printDeadlockAnalysis(analysis: ReachabilityResult): void {
  if (analysis.deadlocks.length === 0) {
    console.log(
      `No deadlocks found across ${analysis.states.length} reachable state(s).`,
    );
    return;
  }

  console.log(`Deadlocks found: ${analysis.deadlocks.length}`);

  for (const [index, deadlock] of analysis.deadlocks.entries()) {
    console.log(`\nDeadlock ${index + 1} at ${formatState(deadlock.state)}`);

    if (deadlock.trace.length === 0) {
      console.log("  The initial state is deadlocked.");
      continue;
    }

    for (const transition of deadlock.trace) {
      console.log(
        `  ${formatState(transition.from)} --${transition.action}--> ` +
          formatState(transition.to),
      );
    }
  }
}

function printPropertyAnalysis(
  propertyName: string,
  analysis: ReachabilityResult,
): void {
  if (analysis.violations.length === 0) {
    console.log(
      `Property ${JSON.stringify(propertyName)} satisfied across ` +
        `${analysis.states.length} reachable state(s).`,
    );
    return;
  }

  const violation = analysis.violations[0]!;
  console.log(
    `Property ${JSON.stringify(propertyName)} violated at ` +
      formatState(violation.state),
  );

  if (violation.trace.length === 0) {
    console.log("  The initial state violates the property.");
    return;
  }

  for (const transition of violation.trace) {
    console.log(
      `  ${formatState(transition.from)} --${transition.action}--> ` +
        formatState(transition.to),
    );
  }
}

function printProgressAnalysis(analysis: ProgressAnalysis): void {
  console.log("Progress analysis uses LTSA fair-choice semantics.");

  for (const result of analysis.results) {
    if (result.satisfied) {
      console.log(`Progress ${JSON.stringify(result.property.name)} satisfied.`);
      continue;
    }

    const violation = result.violation!;
    console.log(`Progress ${JSON.stringify(result.property.name)} violated.`);
    if (violation.prefixTrace.length === 0) {
      console.log("  The initial state is in the violating terminal component.");
    } else {
      console.log("  Shortest trace to the violating terminal component:");
      for (const transition of violation.prefixTrace) {
        console.log(
          `    ${formatState(transition.from)} --${transition.action}--> ` +
            formatState(transition.to),
        );
      }
    }
    console.log(
      `  Recurring actions: ${JSON.stringify(violation.recurringActions)}`,
    );
    console.log(
      `  Missing progress actions: ${JSON.stringify(violation.missingProgressActions)}`,
    );
  }
}

const program = new Command();

program
  .name("anvilts")
  .description("Load and inspect labelled transition systems")
  .requiredOption(
    "-s, --state-machine <path>",
    "path to a state machine JSON file (repeatable)",
    collectPath,
  )
  .option(
    "-c, --compose <processes>",
    "comma-separated process names to compose",
    parseProcessNames,
  )
  .option("-p, --property <path>", "path to a safety-property JSON file")
  .option(
    "--progress <path>",
    "path to an LTSA-style progress-property JSON file (repeatable)",
    collectPath,
  )
  .option("-d, --check-deadlock", "check reachable states for deadlocks")
  .showHelpAfterError()
  .parse();

const options = program.opts<{
  stateMachine: string[];
  compose?: string[];
  property?: string;
  progress?: string[];
  checkDeadlock?: boolean;
}>();

try {
  const loadedMachines = await Promise.all(
    options.stateMachine.map(loadStateMachine),
  );
  const progressProperties = await Promise.all(
    (options.progress ?? []).map(loadProgressProperty),
  );

  let stateMachine: StateMachine;
  let successMessage: string;

  if (options.compose === undefined) {
    if (loadedMachines.length !== 1) {
      throw new Error(
        "Multiple state machines were loaded; use --compose to select processes.",
      );
    }

    stateMachine = loadedMachines[0]!;
    successMessage = "State machine loaded successfully:";
  } else {
    const machinesByName = new Map(
      loadedMachines.map((machine) => [machine.name, machine]),
    );
    const selectedMachines = options.compose.map((name) => {
      const machine = machinesByName.get(name);

      if (machine === undefined) {
        throw new Error(`No loaded state machine is named ${JSON.stringify(name)}.`);
      }

      return machine;
    });
    stateMachine = composeStateMachines(selectedMachines);
    successMessage = "Composite state machine created successfully:";
  }

  const systemMachine = stateMachine;
  let propertyName: string | undefined;

  if (options.property !== undefined) {
    const property = await loadStateMachine(options.property);
    propertyName = property.name;
    stateMachine = monitorProperty(stateMachine, property);
    successMessage = "Property monitor applied successfully:";
  }

  console.log(successMessage);
  console.log(JSON.stringify(stateMachine, null, 2));

  if (options.checkDeadlock === true || propertyName !== undefined) {
    const analysis = detectDeadlocks(stateMachine);
    console.log();

    if (propertyName !== undefined) {
      printPropertyAnalysis(propertyName, analysis);
    }

    if (options.checkDeadlock === true) {
      printDeadlockAnalysis(analysis);
    }
  }

  if (progressProperties.length > 0) {
    const systemAnalysis = detectDeadlocks(systemMachine);
    const progressAnalysis = analyzeProgress(
      systemMachine,
      systemAnalysis,
      progressProperties,
    );
    console.log();
    printProgressAnalysis(progressAnalysis);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`AnviLTS error: ${message}`);
  process.exitCode = 1;
}
