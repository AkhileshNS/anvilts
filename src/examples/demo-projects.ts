import { parseStateMachine, type StateMachine } from "../state-machine";

import boundedBuffer from "../../parity/cases/chapter5_lts__BoundedBuffer__BOUNDEDBUFFER.json";
import printerScannerDeadlock from "../../parity/cases/chapter6_lts__printer_scanner__SYS.json";
import printerScannerReordered from "../../parity/cases/chapter6_lts__printer_scanner_reorder__SYS.json";
import singleLaneBridge from "../../parity/cases/chapter7_lts__SingleLaneBridge__SingleLaneBridge.json";
import cruiseControl from "../../parity/cases/chapter8_lts__CruiseControl__CONTROL.json";
import revisedCruiseControl from "../../parity/cases/chapter8_lts__RevisedCruiseControl__CONTROL.json";

type DemoVerdict =
  | "deadlock"
  | "no deadlock"
  | "property violation"
  | "no property violation";

interface ParityFixture {
  name: string;
  inputs: unknown[];
  property?: unknown;
  output: DemoVerdict;
  meta: {
    source: string;
    deadlockTrace?: string[];
    violationTrace?: string[];
    expectedComposite?: {
      states: number;
      transitions: number;
    };
  };
}

export interface DemoVariant {
  id: string;
  label: string;
  description: string;
  machines: StateMachine[];
  property?: StateMachine;
  expectedVerdict: DemoVerdict;
  expectedTrace: string[];
  expectedComposite?: {
    states: number;
    transitions: number;
  };
  source: string;
}

export interface DemoProject {
  id: string;
  shortTitle: string;
  title: string;
  summary: string;
  verificationQuestion: string;
  tags: string[];
  variants: DemoVariant[];
}

function makeVariant(
  fixture: ParityFixture,
  id: string,
  label: string,
  description: string,
): DemoVariant {
  return {
    id,
    label,
    description,
    machines: fixture.inputs.map(parseStateMachine),
    property: fixture.property ? parseStateMachine(fixture.property) : undefined,
    expectedVerdict: fixture.output,
    expectedTrace: fixture.meta.violationTrace ?? fixture.meta.deadlockTrace ?? [],
    expectedComposite: fixture.meta.expectedComposite,
    source: fixture.meta.source,
  };
}

export const DEMO_PROJECTS: DemoProject[] = [
  {
    id: "office-resource-deadlock",
    shortTitle: "Office deadlock",
    title: "Printer and scanner resource deadlock",
    summary:
      "Two document jobs share a printer and scanner. Each job can reserve one device while waiting for the other, creating a circular wait.",
    verificationQuestion:
      "Can both jobs become permanently blocked while each holds one shared device?",
    tags: ["Shared resources", "Lock ordering", "Deadlock"],
    variants: [
      makeVariant(
        printerScannerDeadlock as ParityFixture,
        "opposing-order",
        "Opposing acquisition order",
        "The jobs acquire the printer and scanner in different orders, allowing a deadlock.",
      ),
      makeVariant(
        printerScannerReordered as ParityFixture,
        "consistent-order",
        "Consistent acquisition order",
        "Both jobs acquire shared devices in the same order, removing the circular wait.",
      ),
    ],
  },
  {
    id: "cruise-control-safety",
    shortTitle: "Cruise control",
    title: "Automotive cruise-control safety",
    summary:
      "A controller coordinates engine, driver, and speed-control events while a safety monitor checks that control is disengaged in unsafe situations.",
    verificationQuestion:
      "Can cruise control remain active after an event that should force it to disengage?",
    tags: ["Automotive", "Safety property", "Counterexample"],
    variants: [
      makeVariant(
        cruiseControl as ParityFixture,
        "original-controller",
        "Original controller",
        "The original controller contains a trace that violates the cruise-safety monitor.",
      ),
      makeVariant(
        revisedCruiseControl as ParityFixture,
        "revised-controller",
        "Revised controller",
        "The revised design satisfies the improved safety monitor across its reachable states.",
      ),
    ],
  },
  {
    id: "single-lane-bridge",
    shortTitle: "Single-lane bridge",
    title: "Single-lane bridge traffic control",
    summary:
      "Two opposing convoys share a bridge that can safely carry traffic in only one direction at a time.",
    verificationQuestion:
      "Can red and blue vehicles ever occupy the single-lane bridge simultaneously?",
    tags: ["Traffic control", "Mutual exclusion", "Safety property"],
    variants: [
      makeVariant(
        singleLaneBridge as ParityFixture,
        "controlled-bridge",
        "Controlled bridge",
        "Eleven concurrent components coordinate vehicle entry and exit against a one-way safety monitor.",
      ),
    ],
  },
  {
    id: "bounded-work-queue",
    shortTitle: "Bounded work queue",
    title: "Producer-consumer work queue",
    summary:
      "A producer and consumer coordinate through a bounded queue with capacity five, preventing underflow and overflow through synchronization.",
    verificationQuestion:
      "Can the producer, queue, and consumer reach a state where no operation is possible?",
    tags: ["Messaging", "Backpressure", "Deadlock freedom"],
    variants: [
      makeVariant(
        boundedBuffer as ParityFixture,
        "capacity-five",
        "Capacity-five queue",
        "The producer and consumer synchronize with a five-slot buffer without reaching deadlock.",
      ),
    ],
  },
];

export function getDemoProject(id: string | undefined): DemoProject | undefined {
  return DEMO_PROJECTS.find((project) => project.id === id);
}
