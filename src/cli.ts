import { readFile } from "node:fs/promises";
import { Command } from "commander";

import { parseStateMachineJson } from "./state-machine.ts";

const program = new Command();

program
  .name("anvilts")
  .description("Load and inspect labelled transition systems")
  .requiredOption(
    "-s, --state-machine <path>",
    "path to a state machine JSON file",
  )
  .showHelpAfterError()
  .parse();

const options = program.opts<{ stateMachine: string }>();

try {
  // Reading a local path belongs to the CLI interface. The core receives only
  // the JSON contents, which a future web interface can provide differently.
  const contents = await readFile(options.stateMachine, "utf8");
  const stateMachine = parseStateMachineJson(contents);

  console.log("State machine loaded successfully:");
  console.log(JSON.stringify(stateMachine, null, 2));
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Unable to load state machine: ${message}`);
  process.exitCode = 1;
}
