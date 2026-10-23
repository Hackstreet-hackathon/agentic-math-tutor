import { ownedDocument } from "@/lib/server/access";
import { json, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";

/** Processing status (polled by the workspace while text extraction runs). */
export const GET = route<{ id: string }>(async (_req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const d = await ownedDocument(user.id, id);
  const meta = (d.metadata ?? {}) as { scannedPages?: number[]; hasTextLayer?: boolean };
  return json({
    document: {
      id: d.id,
      originalName: d.originalName,
      status: d.status,
      statusMessage: d.statusMessage,
      pageCount: d.pageCount,
      scannedPages: meta.scannedPages ?? [],
      hasTextLayer: meta.hasTextLayer ?? null,
    },
  });
});
