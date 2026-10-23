import type { Verification } from "@/lib/ai/answer";
import { env } from "../env";

export type VerificationType = "equivalence" | "factoring" | "expansion" | "solving";

export interface VerificationRequest {
  type: VerificationType;
  /** Left-hand side: the original expression or equation (LaTeX). */
  lhs: string;
  /** Right-hand side: the proposed answer/result (LaTeX). */
  rhs: string;
  variable?: string;
}

interface ServiceResponse {
  status: "VERIFIED" | "INCORRECT" | "UNCERTAIN" | "UNSUPPORTED";
  note?: string;
}

/** Call the SymPy verification service.  Returns UNSUPPORTED when not configured. */
export async function checkMath(req: VerificationRequest, signal?: AbortSignal): Promise<Verification> {
  const url = env().MATH_SERVICE_URL;
  if (!url) return { status: "UNSUPPORTED" };

  try {
    const res = await fetch(`${url}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
      signal,
    });
    if (!res.ok) return { status: "UNCERTAIN", note: `Verification service returned ${res.status}` };
    const data = (await res.json()) as ServiceResponse;
    return { status: data.status, note: data.note };
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return { status: "UNCERTAIN" };
    return { status: "UNCERTAIN", note: "Could not reach the verification service." };
  }
}

/**
 * Attempt to automatically verify an AI answer.
 * Tries to match the answer intent to a verification strategy.
 * Returns UNSUPPORTED when no strategy applies.
 */
export async function autoVerify(opts: {
  intent: string;
  question: string;
  finalAnswer: string | null;
  steps: { latex: string }[];
  signal?: AbortSignal;
}): Promise<Verification> {
  const { intent, question, finalAnswer, steps, signal } = opts;
  if (!finalAnswer) return { status: "UNSUPPORTED" };

  const url = env().MATH_SERVICE_URL;
  if (!url) return { status: "UNSUPPORTED" };

  // For solve intent: check that the final answer satisfies the equation in the question.
  if (intent === "solve") {
    // Extract the equation from the question (look for = sign in LaTeX)
    const eqMatch = /[^=]+=/.exec(question);
    if (eqMatch) {
      const lhsRaw = question.split("=")[0]?.trim();
      if (lhsRaw) {
        return checkMath({ type: "solving", lhs: lhsRaw, rhs: finalAnswer }, signal);
      }
    }
  }

  // For check/equivalence: check that steps are algebraically consistent.
  // Compare the last latex step to the final answer.
  if ((intent === "solve" || intent === "check") && steps.length > 0) {
    const lastStep = steps[steps.length - 1]?.latex;
    if (lastStep && lastStep !== finalAnswer) {
      return checkMath({ type: "equivalence", lhs: lastStep, rhs: finalAnswer }, signal);
    }
  }

  // For factoring/expansion hints
  if (intent === "simplify" || question.toLowerCase().includes("factor")) {
    if (steps.length > 0) {
      const first = steps[0]?.latex;
      if (first) return checkMath({ type: "factoring", lhs: first, rhs: finalAnswer }, signal);
    }
  }

  return { status: "UNSUPPORTED" };
}
