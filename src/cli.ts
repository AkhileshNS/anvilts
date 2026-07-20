import { readFile } from "node:fs/promises";
import { Command } from "commander";

import { composeStateMachines } from "./compose.ts";
import { detectDeadlocks } from "./reachability.ts";
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

function formatState(state: State): string {
  return JSON.stringify(state);
}

function printDeadlockAnalysis(machine: StateMachine): void {
  const analysis = detectDeadlocks(machine);

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
  .option("-d, --check-deadlock", "check reachable states for deadlocks")
  .showHelpAfterError()
  .parse();

const options = program.opts<{
  stateMachine: string[];
  compose?: string[];
  checkDeadlock?: boolean;
}>();

try {
  const loadedMachines = await Promise.all(
    options.stateMachine.map(loadStateMachine),
  );

  let stateMachine: StateMachine;

  if (options.compose === undefined) {
    if (loadedMachines.length !== 1) {
      throw new Error(
        "Multiple state machines were loaded; use --compose to select processes.",
      );
    }

    stateMachine = loadedMachines[0]!;
    console.log("State machine loaded successfully:");
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
    console.log("Composite state machine created successfully:");
  }

  console.log(JSON.stringify(stateMachine, null, 2));

  if (options.checkDeadlock === true) {
    console.log();
    printDeadlockAnalysis(stateMachine);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unable to load state machine: ${message}`);
  process.exitCode = 1;
}
