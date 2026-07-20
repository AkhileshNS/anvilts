import { useCallback, useMemo, useRef } from "react";
import {
  Excalidraw,
  THEME,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

import type { DemoProject } from "../examples/demo-projects";
import {
  createSystemSketch,
  type SystemSketch,
} from "../sketch/system-sketch";

type ExcalidrawProps = React.ComponentProps<typeof Excalidraw>;
type SceneElements = Parameters<NonNullable<ExcalidrawProps["onChange"]>>[0];
type SceneElement = SceneElements[number];

interface ElementRevision {
  version: number;
  isDeleted: boolean;
}

export interface SceneChangeSummary {
  revision: number;
  elementCount: number;
  added: string[];
  updated: string[];
  deleted: string[];
  unmapped: string[];
}

interface WhiteboardProps {
  project?: DemoProject;
  variantId?: string;
  onSceneChange?: (summary: SceneChangeSummary) => void;
}

// Excalidraw's dark theme filters the drawing canvas. Scene colors therefore
// stay in light-theme color space and are rendered dark by Excalidraw.
const SCENE_BACKGROUND = "#ffffff";
const SCENE_FOREGROUND = "#1b1b1f";
const SCENE_MUTED = "#495057";
const SCENE_CARD_BACKGROUND = "#f1f3f5";
const SCENE_LAYOUT_VERSION = 2;

function getEntityId(element: SceneElement): string | undefined {
  const customData = element.customData as Record<string, unknown> | undefined;
  return typeof customData?.anviltsEntityId === "string"
    ? customData.anviltsEntityId
    : undefined;
}

function createInitialElements(sketch: SystemSketch) {
  const columns = Math.min(
    sketch.processes.length === 4 ? 2 : 3,
    Math.max(1, sketch.processes.length),
  );
  const cardWidth = 260;
  const cardHeight = 112;
  const horizontalGap = 150;
  const verticalGap = 140;

  const processSkeletons: Array<Record<string, unknown>> = sketch.processes.map(
    (process, index) => ({
      type: "rectangle",
      id: process.id,
      x: (index % columns) * (cardWidth + horizontalGap),
      y: Math.floor(index / columns) * (cardHeight + verticalGap),
      width: cardWidth,
      height: cardHeight,
      strokeColor: SCENE_FOREGROUND,
      backgroundColor: SCENE_CARD_BACKGROUND,
      fillStyle: "solid",
      roundness: { type: 3 },
      label: {
        text: process.name,
        fontSize: 18,
        strokeColor: SCENE_FOREGROUND,
      },
      customData: {
        anviltsEntityId: process.id,
        anviltsEntityType: "process",
      },
    }),
  );

  const positionByProcess = new Map(
    sketch.processes.map((process, index) => [
      process.id,
      {
        x: (index % columns) * (cardWidth + horizontalGap),
        y: Math.floor(index / columns) * (cardHeight + verticalGap),
      },
    ]),
  );

  const processOrder = new Map(
    sketch.processes.map((process, index) => [process.id, index]),
  );
  const connectorGroups = new Map<
    string,
    {
      startId: string;
      endId: string;
      interactionIds: string[];
      actions: string[];
    }
  >();

  for (const interaction of sketch.interactions) {
    const [firstParticipant, ...otherParticipants] = interaction.participantIds;

    if (!firstParticipant) {
      continue;
    }

    for (const participant of otherParticipants) {
      const pair = [firstParticipant, participant].sort(
        (left, right) => processOrder.get(left)! - processOrder.get(right)!,
      );
      const key = pair.join("--");
      const existing = connectorGroups.get(key);

      if (existing) {
        existing.interactionIds.push(interaction.id);
        existing.actions.push(interaction.action);
      } else {
        connectorGroups.set(key, {
          startId: pair[0]!,
          endId: pair[1]!,
          interactionIds: [interaction.id],
          actions: [interaction.action],
        });
      }
    }
  }

  const connectorSkeletons: Array<Record<string, unknown>> = [];

  for (const [groupId, connector] of [...connectorGroups].slice(0, 12)) {
    const start = positionByProcess.get(connector.startId);
    const end = positionByProcess.get(connector.endId);

    if (!start || !end) {
      continue;
    }

    const startCenter = {
      x: start.x + cardWidth / 2,
      y: start.y + cardHeight / 2,
    };
    const endCenter = {
      x: end.x + cardWidth / 2,
      y: end.y + cardHeight / 2,
    };
    const deltaX = endCenter.x - startCenter.x;
    const deltaY = endCenter.y - startCenter.y;
    const edgeScale =
      1 /
      Math.max(
        Math.abs(deltaX) / (cardWidth / 2),
        Math.abs(deltaY) / (cardHeight / 2),
      );
    const startPoint = {
      x: startCenter.x + deltaX * edgeScale,
      y: startCenter.y + deltaY * edgeScale,
    };
    const endPoint = {
      x: endCenter.x - deltaX * edgeScale,
      y: endCenter.y - deltaY * edgeScale,
    };
    const actionNames = [
      ...new Set(
        connector.actions.map((action) => action.split(".").at(-1) ?? action),
      ),
    ];
    const label =
      actionNames.length <= 3
        ? actionNames.join(" · ")
        : `${actionNames.slice(0, 3).join(" · ")} +${actionNames.length - 3}`;

    connectorSkeletons.push({
      type: "arrow",
      id: `connector-${groupId}`,
      x: startPoint.x,
      y: startPoint.y,
      points: [
        [0, 0],
        [endPoint.x - startPoint.x, endPoint.y - startPoint.y],
      ],
      start: { id: connector.startId, type: "rectangle" },
      end: { id: connector.endId, type: "rectangle" },
      strokeColor: SCENE_MUTED,
      strokeWidth: 2,
      endArrowhead: "arrow",
      label: {
        text: label,
        fontSize: 13,
        strokeColor: SCENE_FOREGROUND,
      },
      customData: {
        anviltsEntityId: connector.interactionIds.join("|"),
        anviltsInteractionIds: connector.interactionIds,
        anviltsEntityType: "interaction-group",
      },
    });
  }

  return convertToExcalidrawElements(
    [...connectorSkeletons, ...processSkeletons] as Parameters<
      typeof convertToExcalidrawElements
    >[0],
    { regenerateIds: false },
  );
}

export function Whiteboard({
  project,
  variantId,
  onSceneChange,
}: WhiteboardProps) {
  const sketch = useMemo(
    () => createSystemSketch(project, variantId),
    [project, variantId],
  );
  const initialElements = useMemo(() => createInitialElements(sketch), [sketch]);
  const knownElements = useRef<Map<string, ElementRevision> | null>(null);
  const revision = useRef(0);

  const initializeEditor = useCallback<
    NonNullable<ExcalidrawProps["excalidrawAPI"]>
  >((api) => {
    api.updateScene({
      appState: {
        theme: THEME.DARK,
        viewBackgroundColor: SCENE_BACKGROUND,
        gridModeEnabled: false,
        currentItemStrokeColor: SCENE_FOREGROUND,
      },
    });
  }, []);

  const handleChange = useCallback<NonNullable<ExcalidrawProps["onChange"]>>(
    (elements) => {
      const current = new Map<string, ElementRevision>();

      for (const element of elements) {
        current.set(element.id, {
          version: element.version,
          isDeleted: element.isDeleted,
        });
      }

      if (knownElements.current === null) {
        knownElements.current = current;
        return;
      }

      const added: string[] = [];
      const updated: string[] = [];
      const deleted: string[] = [];
      const unmapped: string[] = [];

      for (const element of elements) {
        const previous = knownElements.current.get(element.id);
        const entityId = getEntityId(element);

        if (!previous && !element.isDeleted) {
          added.push(entityId ?? element.id);
        } else if (previous && !previous.isDeleted && element.isDeleted) {
          deleted.push(entityId ?? element.id);
        } else if (previous && previous.version !== element.version) {
          updated.push(entityId ?? element.id);
        }

        if (!element.isDeleted && !entityId && element.type !== "text") {
          unmapped.push(element.id);
        }
      }

      knownElements.current = current;

      if (added.length + updated.length + deleted.length === 0) {
        return;
      }

      revision.current += 1;
      onSceneChange?.({
        revision: revision.current,
        elementCount: elements.filter((element) => !element.isDeleted).length,
        added,
        updated,
        deleted,
        unmapped,
      });
    },
    [onSceneChange],
  );

  return (
    <div className="whiteboard-canvas">
      <Excalidraw
        key={`${project?.id ?? "untitled"}-${variantId ?? "default"}-layout-${SCENE_LAYOUT_VERSION}`}
        initialData={{
          elements: initialElements,
          appState: {
            theme: THEME.DARK,
            viewBackgroundColor: SCENE_BACKGROUND,
            gridModeEnabled: false,
            currentItemStrokeColor: SCENE_FOREGROUND,
          },
          scrollToContent: true,
        }}
        excalidrawAPI={initializeEditor}
        gridModeEnabled={false}
        handleKeyboardGlobally={false}
        onChange={handleChange}
        theme={THEME.DARK}
        UIOptions={{
          canvasActions: {
            changeViewBackgroundColor: false,
            clearCanvas: true,
            export: false,
            loadScene: false,
            saveAsImage: false,
            toggleTheme: false,
          },
        }}
      />
    </div>
  );
}
