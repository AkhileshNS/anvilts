// ═══════════════════════════════════════════════════════════════════════════
// LTS-to-Go Transpiler
// Converts Labelled Transition System specifications to idiomatic Go code
// ═══════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A single transition in the LTS
 */
export interface Transition {
  fromState: string;
  toState: string;
  action: string;
}

/**
 * A process definition with its transitions
 */
export interface ProcessDefinition {
  name: string;
  initialState: string;
  transitions: Transition[];
}

/**
 * Complete LTS specification with multiple processes
 */
export interface LTSSpec {
  processes: ProcessDefinition[];
}

/**
 * Alternative flat transition format (can be converted to LTSSpec)
 */
export interface FlatTransition {
  process: string;
  fromState: string;
  toState: string;
  action: string;
}

/**
 * Internal representation of a state with its outgoing transitions
 */
interface StateInfo {
  transitions: Transition[];
}

/**
 * Action usage tracking for sender/receiver assignment
 */
interface ActionUsage {
  processes: Set<string>;
  sender?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a flat transition array to a structured LTSSpec
 */
export function flatToSpec(transitions: FlatTransition[]): LTSSpec {
  const processMap = new Map<string, { states: Set<string>; transitions: Transition[] }>();

  for (const t of transitions) {
    if (!processMap.has(t.process)) {
      processMap.set(t.process, { states: new Set(), transitions: [] });
    }
    const proc = processMap.get(t.process)!;
    proc.states.add(t.fromState);
    proc.states.add(t.toState);
    proc.transitions.push({
      fromState: t.fromState,
      toState: t.toState,
      action: t.action,
    });
  }

  const processes: ProcessDefinition[] = [];
  for (const [name, data] of processMap) {
    // Determine initial state (first fromState that appears, or smallest alphabetically)
    const fromStates = data.transitions.map(t => t.fromState);
    const toStates = new Set(data.transitions.map(t => t.toState));
    
    // Initial state is one that only appears as fromState (not a target), or the first one
    let initialState = fromStates[0];
    for (const s of fromStates) {
      if (!toStates.has(s) || s === name || s === `${name}0` || s === '0') {
        initialState = s;
        break;
      }
    }

    processes.push({
      name,
      initialState,
      transitions: data.transitions,
    });
  }

  return { processes };
}

/**
 * Sanitize a name to be a valid Go identifier
 */
function sanitizeGoName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^(\d)/, '_$1');
}

/**
 * Generate a valid Go channel name from an action
 */
function channelName(action: string): string {
  return `ch_${sanitizeGoName(action)}`;
}

/**
 * Generate a valid Go function name from a process name
 */
function funcName(process: string): string {
  return `Process_${sanitizeGoName(process)}`;
}

/**
 * Generate a valid Go state constant from a state name
 */
function stateName(process: string, state: string): string {
  return `"${process}_${state}"`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Analysis Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract all unique actions from the spec
 */
function extractActions(spec: LTSSpec): Set<string> {
  const actions = new Set<string>();
  for (const proc of spec.processes) {
    for (const t of proc.transitions) {
      actions.add(t.action);
    }
  }
  return actions;
}

/**
 * Analyze action usage across processes for sender/receiver assignment
 */
function analyzeActionUsage(spec: LTSSpec): Map<string, ActionUsage> {
  const usage = new Map<string, ActionUsage>();

  for (const proc of spec.processes) {
    for (const t of proc.transitions) {
      if (!usage.has(t.action)) {
        usage.set(t.action, { processes: new Set() });
      }
      usage.get(t.action)!.processes.add(proc.name);
    }
  }

  // Assign senders: first process (alphabetically) that uses the action is the sender
  for (const [action, info] of usage) {
    const procs = Array.from(info.processes).sort();
    info.sender = procs[0];
  }

  return usage;
}

/**
 * Build a state map for a process: state -> outgoing transitions
 */
function buildStateMap(proc: ProcessDefinition): Map<string, StateInfo> {
  const stateMap = new Map<string, StateInfo>();

  for (const t of proc.transitions) {
    if (!stateMap.has(t.fromState)) {
      stateMap.set(t.fromState, { transitions: [] });
    }
    stateMap.get(t.fromState)!.transitions.push(t);
  }

  return stateMap;
}

/**
 * Get all unique states in a process
 */
function getAllStates(proc: ProcessDefinition): Set<string> {
  const states = new Set<string>();
  for (const t of proc.transitions) {
    states.add(t.fromState);
    states.add(t.toState);
  }
  return states;
}

// ─────────────────────────────────────────────────────────────────────────────
// Code Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the Go package header and imports
 */
function generateHeader(hasNonSharedActions: boolean): string {
  const imports = ['"fmt"', '"sync"'];
  if (hasNonSharedActions) {
    imports.push('"context"');
  }
  
  return `package main

import (
\t${imports.join('\n\t')}
)

`;
}

/**
 * Generate channel declarations for shared actions only
 */
function generateChannelDeclarations(
  actions: Set<string>,
  actionUsage: Map<string, ActionUsage>
): string {
  // Only create channels for shared actions (used by multiple processes)
  const sharedActions = Array.from(actions)
    .filter(action => actionUsage.get(action)!.processes.size > 1)
    .sort();

  if (sharedActions.length === 0) return '';

  const lines = ['// Channels for action synchronization (shared actions only)'];
  lines.push('var (');
  
  for (const action of sharedActions) {
    lines.push(`\t${channelName(action)} = make(chan struct{}) // shared action: ${action}`);
  }
  
  lines.push(')');
  lines.push('');
  return lines.join('\n');
}

/**
 * Generate a single case block for a state
 */
function generateStateCase(
  proc: ProcessDefinition,
  state: string,
  stateInfo: StateInfo | undefined,
  actionUsage: Map<string, ActionUsage>,
  allStates: Set<string>
): string {
  const lines: string[] = [];
  const caseLabel = stateName(proc.name, state);
  
  lines.push(`\t\tcase ${caseLabel}:`);

  // Check if this is a terminal state (STOP or no outgoing transitions)
  if (!stateInfo || stateInfo.transitions.length === 0 || state === 'STOP') {
    lines.push(`\t\t\tfmt.Printf("[${proc.name}] Reached terminal state: ${state}\\n")`);
    lines.push(`\t\t\treturn`);
    return lines.join('\n');
  }

  const transitions = stateInfo.transitions;

  if (transitions.length === 1) {
    // Single transition: direct channel operation
    const t = transitions[0];
    const usage = actionUsage.get(t.action)!;
    const isSender = usage.sender === proc.name;
    const isShared = usage.processes.size > 1;
    const chName = channelName(t.action);

    if (isShared) {
      // Shared action: synchronous handshake between processes
      if (isSender) {
        lines.push(`\t\t\t${chName} <- struct{}{} // send: ${t.action}`);
      } else {
        lines.push(`\t\t\t<-${chName} // receive: ${t.action}`);
      }
    }
    // Non-shared actions don't need channel operations - just log
    
    lines.push(`\t\t\tfmt.Printf("[${proc.name}] action: ${t.action} (${state} -> ${t.toState})\\n")`);
    lines.push(`\t\t\tstate = ${stateName(proc.name, t.toState)}`);
  } else {
    // Multiple transitions: check if any are shared
    const hasSharedTransition = transitions.some(t => {
      const usage = actionUsage.get(t.action)!;
      return usage.processes.size > 1;
    });

    if (hasSharedTransition) {
      // Use select for choice with shared actions
      lines.push(`\t\t\tselect {`);

      for (const t of transitions) {
        const usage = actionUsage.get(t.action)!;
        const isSender = usage.sender === proc.name;
        const isShared = usage.processes.size > 1;
        const chName = channelName(t.action);

        if (isShared) {
          if (isSender) {
            lines.push(`\t\t\tcase ${chName} <- struct{}{}: // send: ${t.action}`);
          } else {
            lines.push(`\t\t\tcase <-${chName}: // receive: ${t.action}`);
          }
        } else {
          // Non-shared action in a select - use a default-like pattern
          // We'll handle this by just allowing it as an option
          lines.push(`\t\t\tdefault: // non-shared action: ${t.action}`);
        }
        
        lines.push(`\t\t\t\tfmt.Printf("[${proc.name}] action: ${t.action} (${state} -> ${t.toState})\\n")`);
        lines.push(`\t\t\t\tstate = ${stateName(proc.name, t.toState)}`);
      }

      lines.push(`\t\t\t}`);
    } else {
      // All transitions are non-shared - just pick the first one deterministically
      // (In a real LTS, non-deterministic choice would need special handling)
      const t = transitions[0];
      lines.push(`\t\t\t// Non-deterministic choice (picking first option): ${transitions.map(tr => tr.action).join(' | ')}`);
      lines.push(`\t\t\tfmt.Printf("[${proc.name}] action: ${t.action} (${state} -> ${t.toState})\\n")`);
      lines.push(`\t\t\tstate = ${stateName(proc.name, t.toState)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Generate a Go function for a single process
 */
function generateProcessFunction(
  proc: ProcessDefinition,
  actionUsage: Map<string, ActionUsage>
): string {
  const lines: string[] = [];
  const fName = funcName(proc.name);
  const stateMap = buildStateMap(proc);
  const allStates = getAllStates(proc);

  lines.push(`// ${fName} implements the ${proc.name} process`);
  lines.push(`func ${fName}(wg *sync.WaitGroup) {`);
  lines.push(`\tdefer wg.Done()`);
  lines.push(`\tfmt.Printf("[${proc.name}] Starting...\\n")`);
  lines.push(``);
  lines.push(`\tstate := ${stateName(proc.name, proc.initialState)}`);
  lines.push(``);
  lines.push(`\tfor {`);
  lines.push(`\t\tswitch state {`);

  // Generate case for each state
  for (const state of Array.from(allStates).sort()) {
    const stateInfo = stateMap.get(state);
    lines.push(generateStateCase(proc, state, stateInfo, actionUsage, allStates));
  }

  // Add default case for unknown states
  lines.push(`\t\tdefault:`);
  lines.push(`\t\t\tfmt.Printf("[${proc.name}] Unknown state: %s\\n", state)`);
  lines.push(`\t\t\treturn`);

  lines.push(`\t\t}`);
  lines.push(`\t}`);
  lines.push(`}`);
  lines.push(``);

  return lines.join('\n');
}


/**
 * Generate the main() function
 */
function generateMain(spec: LTSSpec): string {
  const lines: string[] = [];

  lines.push(`func main() {`);
  lines.push(`\tfmt.Println("═══════════════════════════════════════════════════════════════")`);
  lines.push(`\tfmt.Println("  LTS Execution Started")`);
  lines.push(`\tfmt.Println("═══════════════════════════════════════════════════════════════")`);
  lines.push(`\tfmt.Println()`);
  lines.push(``);
  lines.push(`\tvar wg sync.WaitGroup`);
  lines.push(``);
  lines.push(`\twg.Add(${spec.processes.length})`);
  lines.push(``);

  // Launch process goroutines
  lines.push(`\t// Launch process goroutines`);
  for (const proc of spec.processes) {
    lines.push(`\tgo ${funcName(proc.name)}(&wg)`);
  }

  lines.push(``);
  lines.push(`\t// Wait for all processes to complete`);
  lines.push(`\twg.Wait()`);
  lines.push(``);
  lines.push(`\tfmt.Println()`);
  lines.push(`\tfmt.Println("═══════════════════════════════════════════════════════════════")`);
  lines.push(`\tfmt.Println("  LTS Execution Complete")`);
  lines.push(`\tfmt.Println("═══════════════════════════════════════════════════════════════")`);
  lines.push(`}`);

  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Transpiler Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transpile an LTS specification to Go source code
 * @param spec The LTS specification to transpile
 * @returns A string containing valid, executable Go source code
 */
export function transpile(spec: LTSSpec): string {
  // Validate input
  if (!spec.processes || spec.processes.length === 0) {
    throw new Error('LTS specification must contain at least one process');
  }

  // Analyze the specification
  const actions = extractActions(spec);
  const actionUsage = analyzeActionUsage(spec);

  // Generate code sections
  const parts: string[] = [];

  // We no longer need context since we removed the action sink
  parts.push(generateHeader(false));
  parts.push(generateChannelDeclarations(actions, actionUsage));

  // Generate process functions
  for (const proc of spec.processes) {
    parts.push(generateProcessFunction(proc, actionUsage));
  }

  // Generate main function
  parts.push(generateMain(spec));

  return parts.join('\n');
}

/**
 * Transpile from flat transition format
 * @param transitions Array of flat transitions
 * @returns A string containing valid, executable Go source code
 */
export function transpileFlat(transitions: FlatTransition[]): string {
  const spec = flatToSpec(transitions);
  return transpile(spec);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI Entry Point
// ─────────────────────────────────────────────────────────────────────────────

if (require.main === module) {
  const fs = require('fs');

  const args = process.argv.slice(2);

  if (args.length < 1) {
    console.log(`
LTS-to-Go Transpiler

Usage: npx tsx src/transpiler.ts <input.json> [output.go]

Arguments:
  input.json   JSON file containing the LTS specification
  output.go    Output Go file (optional, defaults to stdout)

Input Format (Structured):
{
  "processes": [
    {
      "name": "P",
      "initialState": "0",
      "transitions": [
        { "fromState": "0", "toState": "1", "action": "a" },
        { "fromState": "1", "toState": "0", "action": "b" }
      ]
    }
  ]
}

Input Format (Flat):
[
  { "process": "P", "fromState": "0", "toState": "1", "action": "a" },
  { "process": "P", "fromState": "1", "toState": "0", "action": "b" }
]

Example:
  npx tsx src/transpiler.ts spec.json output.go
`);
    process.exit(1);
  }

  const inputFile = args[0];
  const outputFile = args[1];

  try {
    const jsonContent = fs.readFileSync(inputFile, 'utf-8');
    const data = JSON.parse(jsonContent);

    let goCode: string;

    // Detect format: flat array or structured spec
    if (Array.isArray(data)) {
      goCode = transpileFlat(data as FlatTransition[]);
    } else if (data.processes) {
      goCode = transpile(data as LTSSpec);
    } else {
      throw new Error('Invalid input format. Expected either an array of flat transitions or an object with "processes" property.');
    }

    if (outputFile) {
      fs.writeFileSync(outputFile, goCode, 'utf-8');
      console.log(`✓ Generated Go code written to: ${outputFile}`);
    } else {
      console.log(goCode);
    }
  } catch (err) {
    console.error(`Error: ${err}`);
    process.exit(1);
  }
}
