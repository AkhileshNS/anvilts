import type { DemoProject } from "../examples/demo-projects";

export type KnowledgeStatus = "confirmed" | "inferred" | "unresolved";

export interface ProcessSketch {
  id: string;
  name: string;
  description: string;
  status: KnowledgeStatus;
}

export interface InteractionSketch {
  id: string;
  action: string;
  participantIds: string[];
  description: string;
  status: KnowledgeStatus;
}

export interface SketchAssumption {
  id: string;
  text: string;
  status: KnowledgeStatus;
}

export interface SystemSketch {
  id: string;
  title: string;
  revision: number;
  processes: ProcessSketch[];
  interactions: InteractionSketch[];
  assumptions: SketchAssumption[];
  unresolvedQuestions: string[];
}

function safeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function displayProcessName(name: string): string {
  const scopedName = name.includes("::") ? name.split("::").at(-1)! : name;
  const parts = scopedName.split(":");

  if (parts.length > 1) {
    const role = parts.at(-1)!;
    const subject = parts.at(-2)!;

    if (role.toLowerCase() === "resource") {
      return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} resource`;
    }

    return `Process ${role}`;
  }

  return name
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function createSystemSketch(project?: DemoProject): SystemSketch {
  if (!project) {
    return {
      id: "untitled-system",
      title: "Untitled system",
      revision: 0,
      processes: [],
      interactions: [],
      assumptions: [],
      unresolvedQuestions: [],
    };
  }

  const machines = project.variants[0]!.machines;
  const processes = machines.map((machine, index) => ({
    id: `process-${index}-${safeId(machine.name)}`,
    name: displayProcessName(machine.name),
    description: `${machine.name} has ${machine.transitions.length} transition(s).`,
    status: "confirmed" as const,
  }));

  const interactions = [
    ...new Set(machines.flatMap((machine) => machine.alphabet)),
  ].flatMap((action, index) => {
    const participantIds = machines.flatMap((machine, machineIndex) =>
      machine.alphabet.includes(action) ? [processes[machineIndex]!.id] : [],
    );

    if (participantIds.length < 2) {
      return [];
    }

    return [
      {
        id: `interaction-${index}-${safeId(action)}`,
        action,
        participantIds,
        description: `${participantIds.length} processes synchronize on ${action}.`,
        status: "confirmed" as const,
      },
    ];
  });

  return {
    id: project.id,
    title: project.title,
    revision: 0,
    processes,
    interactions,
    assumptions: [
      {
        id: "fixture-provenance",
        text: "This example was reconstructed from an LTSA textbook parity fixture.",
        status: "confirmed",
      },
    ],
    unresolvedQuestions: [],
  };
}
