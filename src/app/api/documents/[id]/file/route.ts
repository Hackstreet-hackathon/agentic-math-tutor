import { ownedDocument } from "@/lib/server/access";
import { HttpError, route } from "@/lib/server/http";
import { requireUser } from "@/lib/server/session";
import { storage, StorageNotFoundError } from "@/lib/server/storage";

/** Streams the original, unmodified PDF to its owner. */
export const GET = route<{ id: string }>(async (req, { params }) => {
  const user = await requireUser();
  const { id } = await params;
  const doc = await ownedDocument(user.id, id);
  const etag = `"${doc.sha256}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });

  let bytes: Uint8Array;
  try {
    bytes = await storage().get(doc.storageKey);
  } catch (e) {
    if (e instanceof StorageNotFoundError) throw new HttpError(404, "The stored file is missing", "file_missing");
    throw e;
  }
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
      ETag: etag,
    },
  });
});
