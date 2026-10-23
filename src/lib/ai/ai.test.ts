import { describe, expect, it } from "vitest";
import { ANSWER_JSON_SCHEMA, answerFromPlainText, normalizeAnswer } from "./answer";
import { parsePartialJson } from "./partial-json";
import { routeIntent, type RouteInput } from "./router";

const base: RouteInput = { message: "", hasSelection: true, hasPageContent: true, hasPreviousAssistantMessage: false };
const route = (message: string, extra: Partial<RouteInput> = {}) => routeIntent({ ...base, message, ...extra });

describe("routeIntent (deterministic)", () => {
  it.each([
    ["Check my work", "check"],
    ["is this correct?", "check"],
    ["did I get it right", "check"],
    ["Give me a hint", "hint"],
    ["I'm stuck", "hint"],
    ["What's wrong with step 2?", "mistake"],
    ["where did I go wrong", "mistake"],
    ["Solve this step by step", "solve"],
    ["factorise it", "solve"],
    ["explain this", "explain"],
    ["why does the discriminant matter", "explain"],
    ["can you explain it more simply", "simplify"],
    ["summarize these notes", "summarize"],
    ["graph this function", "graph"],
    ["describe the diagram", "diagram"],
    ["write the solution on the page", "insert"],
  ] as const)("%s -> %s", (msg, intent) => {
    expect(route(msg).intent).toBe(intent);
  });

  it("explicit action buttons always win and skip rules", () => {
    const r = route("whatever", { explicitIntent: "hint" });
    expect(r).toMatchObject({ intent: "hint", via: "explicit" });
  });

  it("treats short pronoun-led replies as follow-ups only after an assistant message", () => {
    expect(route("why?", { hasSelection: false, hasPreviousAssistantMessage: true }).intent).toBe("followup");
    expect(route("why?", { hasSelection: false, hasPreviousAssistantMessage: false }).intent).not.toBe("followup");
  });

  it("asks for clarification instead of guessing when there is no target", () => {
    const r = route("check my work", { hasSelection: false, hasPageContent: false });
    expect(r.clarification).toMatch(/Circle a question/);
    expect(route("solve x^2 + 5x + 6 = 0", { hasSelection: false, hasPageContent: false }).clarification).toBeUndefined();
  });

  it("general conceptual questions need no selection; deictic ones do", () => {
    const none = { hasSelection: false, hasPageContent: false };
    expect(route("What is a quadratic equation?", none)).toMatchObject({ intent: "explain" });
    expect(route("What is a quadratic equation?", none).clarification).toBeUndefined();
    expect(route("explain this", none).clarification).toBeDefined();
    expect(route("explain this", { ...none, hasPageContent: true }).clarification).toBeUndefined(); // page-level
    expect(route("explain it more simply", { ...none, hasPreviousAssistantMessage: true }).clarification).toBeUndefined();
    expect(route("explain it more simply", none).clarification).toBeDefined();
    expect(route("solve this", none).clarification).toBeDefined();
  });

  it("allows page-level summaries when the page has content", () => {
    expect(route("summarize this page", { hasSelection: false, hasPageContent: true }).clarification).toBeUndefined();
    expect(route("summarize this page", { hasSelection: false, hasPageContent: false }).clarification).toBeDefined();
  });

  it("falls back to general for open questions without extra LLM calls", () => {
    expect(route("hello there", { hasSelection: false, hasPageContent: false })).toMatchObject({ intent: "general", via: "default" });
  });
});

describe("parsePartialJson", () => {
  const doc = JSON.stringify({ summary: "We factor $x^2$", steps: [{ latex: "x^2+5x+6=0", explanation: "Start" }, { latex: "(x+2)(x+3)=0", explanation: "Factor" }], finalAnswer: "x=-2" });

  it("always yields a prefix-consistent object for every cut point of a complete document", () => {
    let lastSummaryLen = 0;
    for (let i = 1; i <= doc.length; i++) {
      const v = parsePartialJson(doc.slice(0, i)) as { summary?: string } | undefined;
      if (v && typeof v.summary === "string") {
        expect(v.summary.length).toBeGreaterThanOrEqual(lastSummaryLen); // text only ever grows
        lastSummaryLen = v.summary.length;
      }
    }
    expect(parsePartialJson(doc)).toEqual(JSON.parse(doc));
  });

  it("handles dangling keys, partial literals and unfinished escapes", () => {
    expect(parsePartialJson('{"a":1,"b":')).toEqual({ a: 1 });
    expect(parsePartialJson('{"a":tru')).toEqual({});
    expect(parsePartialJson('{"a":"x\\')).toEqual({ a: "x" });
    expect(parsePartialJson('{"a":"x\\u00')).toEqual({ a: "x" });
    expect(parsePartialJson('{"a":[1,2,')).toEqual({ a: [1, 2] });
    expect(parsePartialJson('{"s":"a \\"quoted')).toEqual({ s: 'a "quoted' });
  });

  it("returns undefined for nothing parseable and never throws on garbage", () => {
    expect(parsePartialJson("")).toBeUndefined();
    expect(() => parsePartialJson("}{][::,,\"")).not.toThrow();
    expect(parsePartialJson("not json at all")).toBeUndefined();
  });
});

describe("normalizeAnswer", () => {
  it("accepts a well-formed answer", () => {
    const a = normalizeAnswer({ intent: "solve", summary: "ok", steps: [{ latex: "x=1", explanation: "done" }], finalAnswer: "x=1" });
    expect(a?.steps).toHaveLength(1);
    expect(a?.confidence).toBe("medium"); // defaulted
  });
  it("repairs slightly-off fields instead of failing", () => {
    const a = normalizeAnswer({ intent: "not-an-intent", summary: "hi", steps: "oops", confidence: "very" });
    expect(a).toMatchObject({ intent: "general", steps: [], confidence: "medium", summary: "hi" });
  });
  it("rejects non-objects and empty answers so callers can fall back", () => {
    expect(normalizeAnswer(null)).toBeNull();
    expect(normalizeAnswer([1, 2])).toBeNull();
    expect(normalizeAnswer("text")).toBeNull();
    expect(normalizeAnswer({ intent: "general" })).toBeNull();
  });
  it("wraps plain text for malformed model output", () => {
    expect(answerFromPlainText("  Some prose.  ", "explain")).toMatchObject({ summary: "Some prose.", intent: "explain", confidence: "low" });
  });
  it("strict JSON schema requires every property (OpenAI strict mode)", () => {
    expect([...ANSWER_JSON_SCHEMA.required].sort()).toEqual(Object.keys(ANSWER_JSON_SCHEMA.properties).sort());
  });
});
