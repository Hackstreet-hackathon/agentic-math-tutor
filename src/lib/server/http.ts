import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "error",
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new HttpError(404, `${what} not found`, "not_found");

type Ctx<P> = { params: Promise<P> };

/** Wraps a route handler with uniform JSON error handling. */
export function route<P = Record<string, never>>(
  handler: (req: Request, ctx: Ctx<P>) => Promise<Response>,
) {
  return async (req: Request, ctx: Ctx<P>): Promise<Response> => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return NextResponse.json({ error: { code: err.code, message: err.message } }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: { code: "invalid_request", message: "Invalid request", issues: err.issues } },
          { status: 400 },
        );
      }
      // Never echo internal error details (may contain connection strings or document text).
      console.error("Unhandled route error:", err instanceof Error ? err.message : "unknown");
      return NextResponse.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
    }
  };
}

export async function parseJson<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, "Request body must be valid JSON", "invalid_json");
  }
  return schema.parse(body);
}

export const json = <T>(data: T, init?: ResponseInit) => NextResponse.json(data, init);
