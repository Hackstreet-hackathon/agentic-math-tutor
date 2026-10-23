import { z } from "zod";
import { INTENTS } from "./answer";

/** Largest region image we accept (base64 data URL characters, ~1.5 MB of image data). */
export const MAX_IMAGE_CHARS = 2_000_000;

export const chatRequestSchema = z.object({
  notebookId: z.string().min(1).max(64),
  pageId: z.string().min(1).max(64),
  conversationId: z.string().min(1).max(64).nullish(),
  message: z.string().trim().min(1, "Type a question first").max(4000),
  /** Set when the student pressed an action button. */
  intent: z.enum(INTENTS).optional(),
  selection: z
    .object({
      /** The circled / boxed region, in page units. */
      region: z
        .object({
          kind: z.enum(["lasso", "rect"]),
          polygon: z.array(z.number().finite()).min(6).max(4000),
          bounds: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().min(0), height: z.number().finite().min(0) }),
        })
        .nullish(),
      objectIds: z.array(z.string().min(1).max(64)).max(100).default([]),
      /** Text the student highlighted in the PDF text layer. */
      text: z.string().max(3000).nullish(),
    })
    .nullish(),
  /** Optional crop of the selected region (PDF + handwriting) for vision-capable models. */
  image: z
    .string()
    .max(MAX_IMAGE_CHARS)
    .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, "Image must be a base64 PNG, JPEG or WebP data URL")
    .nullish(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** What the server tells the client at the start of a stream. */
export interface ChatMeta {
  conversationId: string;
  userMessageId: string;
  intent: (typeof INTENTS)[number];
  routedVia: "explicit" | "rule" | "default";
  /** Honest description of what context was used, shown in the UI. */
  context: ContextSummary;
}

export interface ContextSummary {
  pageNumber: number;
  region: boolean;
  selectedObjects: number;
  selectedTextChars: number;
  nearbyTextChars: number;
  imageSent: boolean;
  imageSkipped: "no_vision" | null;
  scannedPageNoText: boolean;
  references: { page: number; source: "pdf" | "notebook" }[];
}
