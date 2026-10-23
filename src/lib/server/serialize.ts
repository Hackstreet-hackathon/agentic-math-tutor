import type { Prisma } from "@/generated/prisma/client";
import type { NotebookObject } from "@/lib/notebook/schemas";

type ObjectRow = Prisma.PageObjectGetPayload<Record<string, never>>;

/** DB row -> wire/client format (the persisted, library-independent object model). */
export function objectFromRow(row: ObjectRow): NotebookObject {
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    zIndex: row.zIndex,
    data: row.data,
    metadata: (row.metadata ?? null) as Record<string, unknown> | null,
    linkedToId: row.linkedToId,
  } as NotebookObject;
}
