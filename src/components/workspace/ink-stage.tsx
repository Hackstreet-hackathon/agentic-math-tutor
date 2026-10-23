"use client";
import { memo, useMemo } from "react";
import { Arrow, Ellipse, Layer, Line, Path, Rect, Stage } from "react-konva";
import { strokePathData } from "@/lib/notebook/ops";
import type { InkObject, NotebookObject, ShapeObject } from "@/lib/notebook/schemas";

/**
 * Committed ink and shapes. Konva is used purely as a fast renderer here: it has no
 * listeners, and all pointer input is handled by the interaction layer above it.
 */
const InkItem = memo(function InkItem({ o }: { o: InkObject }) {
  const d = useMemo(() => strokePathData(o.data.points, o.data.pressures, o.data), [o.data]);
  return <Path x={o.x} y={o.y} data={d} fill={o.data.color} opacity={o.data.opacity} listening={false} perfectDrawEnabled={false} />;
});

const ShapeItem = memo(function ShapeItem({ o }: { o: ShapeObject }) {
  const { shape, stroke, strokeWidth, fill, flipX, flipY } = o.data;
  const common = { stroke, strokeWidth, listening: false, perfectDrawEnabled: false, fill: fill ?? undefined } as const;
  if (shape === "ellipse") {
    return <Ellipse x={o.x + o.width / 2} y={o.y + o.height / 2} radiusX={o.width / 2} radiusY={o.height / 2} {...common} />;
  }
  if (shape === "rect") return <Rect x={o.x} y={o.y} width={o.width} height={o.height} {...common} />;
  const pts = [flipX ? o.width : 0, flipY ? o.height : 0, flipX ? 0 : o.width, flipY ? 0 : o.height];
  if (shape === "arrow") {
    return <Arrow x={o.x} y={o.y} points={pts} {...common} fill={stroke} pointerLength={10 + strokeWidth} pointerWidth={8 + strokeWidth} lineCap="round" />;
  }
  return <Line x={o.x} y={o.y} points={pts} {...common} lineCap="round" />;
});

export default function InkStage({ width, height, zoom, objects }: { width: number; height: number; zoom: number; objects: NotebookObject[] }) {
  return (
    <Stage
      width={width * zoom}
      height={height * zoom}
      scaleX={zoom}
      scaleY={zoom}
      listening={false}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <Layer listening={false}>
        {objects.map((o) =>
          o.type === "INK" ? <InkItem key={o.id} o={o} /> : o.type === "SHAPE" ? <ShapeItem key={o.id} o={o} /> : null,
        )}
      </Layer>
    </Stage>
  );
}
