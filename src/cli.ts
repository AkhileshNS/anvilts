import { readFile } from "node:fs/promises";
import { Command } from "commander";

import { composeStateMachines } from "./compose.ts";
import {
  parseStateMachineJson,
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
  .showHelpAfterError()
  .parse();

const options = program.opts<{
  stateMachine: string[];
  compose?: string[];
}>();

try {
  const loadedMachines = await Promise.all(
    options.stateMachine.map(loadStateMachine),
  );

  if (options.compose === undefined) {
    if (loadedMachines.length !== 1) {
      throw new Error(
        "Multiple state machines were loaded; use --compose to select processes.",
      );
    }

    console.log("State machine loaded successfully:");
    console.log(JSON.stringify(loadedMachines[0], null, 2));
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
    const composite = composeStateMachines(selectedMachines);

    console.log("Composite state machine created successfully:");
    console.log(JSON.stringify(composite, null, 2));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unable to load state machine: ${message}`);
  process.exitCode = 1;
}
