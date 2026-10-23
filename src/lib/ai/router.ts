import type { Intent } from "./answer";

export interface RouteInput {
  message: string;
  /** Set when the student pressed an action button (Explain / Solve / Check / Hint). */
  explicitIntent?: Intent;
  /** A region, selected objects, or selected PDF text accompany the request. */
  hasSelection: boolean;
  /** The page has typed text/equations or a PDF text layer the question could refer to. */
  hasPageContent: boolean;
  hasPreviousAssistantMessage: boolean;
}

export interface RouteResult {
  intent: Intent;
  /** How the intent was decided. */
  via: "explicit" | "rule" | "default";
  /** If set, ask the student this instead of calling the model. */
  clarification?: string;
}

const RULES: { intent: Intent; re: RegExp }[] = [
  { intent: "mistake", re: /\b(what'?s|what is|where'?s|where is) (wrong|my (mistake|error))\b|\bwhere did i (go wrong|make)\b|\bexplain (my |the )?(mistake|error)\b|\bwhy (is|was) (this|that|my \w+) wrong\b/i },
  { intent: "check", re: /\bcheck (my|the|this|these)\b|\b(is|are) (this|that|my|these)\b.*\b(right|correct|wrong)\b|\bdid i (do|get|solve)\b|\bverify (my|this|the)\b|\bmark my\b/i },
  { intent: "hint", re: /\b(give me |need |want |a )?(hint|nudge|clue)\b|\bi'?m stuck\b|\bwhere do i (start|begin)\b|\bwhat'?s the next step\b|\bwhat should i do next\b/i },
  { intent: "insert", re: /\b(write|put|add|insert|place|copy)\b.*\b(on|onto|into|in|to)\b.*\b(page|notebook|here|paper)\b|\bwrite (it|this|that|the (solution|answer)) (down|out)\b/i },
  { intent: "graph", re: /\b(graph|plot|sketch|draw the (graph|curve))\b/i },
  { intent: "simplify", re: /\b(simpler|simplify (the )?(explanation|this explanation)|in simple (terms|words)|explain (it |this |that )?(more )?(simply|like i'?m)|eli5|i (don'?t|do not) (understand|get) (this|that|it))\b/i },
  { intent: "summarize", re: /\b(summari[sz]e|summary of|tl;?dr|key points|main ideas|recap)\b/i },
  { intent: "diagram", re: /\b(diagram|figure|illustration|chart)\b.*\b(show|mean|explain|describe|read|represent)\b|\b(describe|read|interpret) (the |this )?(diagram|figure|chart|picture|image)\b/i },
  { intent: "solve", re: /\b(solve|solution (to|for)|find (the )?(roots?|solutions?|zeros?|value|answer|derivative|integral|limit)|compute|evaluate|calculate|work (it|this) out|factori[sz]e|differentiate|integrate|expand|simplify (the )?(expression|equation))\b/i },
  { intent: "explain", re: /\b(explain|what (does|is|are)|why (does|is|do|are)|how (does|do|is|can)|walk me through|help me understand|meaning of|tell me about)\b/i },
];

/** Words that point at something on the page or in the conversation. */
const DEICTIC = /\b(this|that|these|those|it|here|the (problem|question|equation|step|steps|diagram|figure|work|answer))\b/i;

const FOLLOW_UP = /^(why|how|what about|and|so|then|but|ok(ay)?|can you|could you|what if|does that|is that)\b/i;

export function routeIntent(input: RouteInput): RouteResult {
  const msg = input.message.trim();
  let intent: Intent;
  let via: RouteResult["via"];

  if (input.explicitIntent) {
    intent = input.explicitIntent;
    via = "explicit";
  } else {
    const hit = RULES.find((r) => r.re.test(msg));
    if (hit) {
      intent = hit.intent;
      via = "rule";
    } else if (input.hasPreviousAssistantMessage && (FOLLOW_UP.test(msg) || msg.split(/\s+/).length <= 7) && !input.hasSelection) {
      intent = "followup";
      via = "rule";
    } else {
      intent = "general";
      via = "default";
    }
  }

  // Does this request need something specific to act on?
  //  - check / hint / mistake / solve are always about particular work or a particular problem;
  //  - explain / simplify / summarize / diagram only when they point at something ("explain THIS").
  //    General questions ("what is a quadratic equation?") need no target.
  const needsTarget =
    intent === "check" || intent === "hint" || intent === "mistake" || intent === "solve" ? true : intent === "explain" || intent === "simplify" || intent === "summarize" || intent === "diagram" ? DEICTIC.test(msg) : false;
  const messageCarriesProblem = /[=+\-*/^<>]|\d/.test(msg) && msg.length > 12;
  if (needsTarget && !input.hasSelection && !messageCarriesProblem) {
    // "explain it more simply" after an answer refers to that answer; "summarise this page" uses the page.
    const refersToPreviousAnswer = input.hasPreviousAssistantMessage && (intent === "explain" || intent === "simplify" || intent === "summarize" || intent === "diagram");
    const pageLevelOk = (intent === "summarize" || intent === "explain" || intent === "diagram") && input.hasPageContent;
    if (!refersToPreviousAnswer && !pageLevelOk) return { intent, via, clarification: clarificationFor(intent) };
  }
  return { intent, via };
}

function clarificationFor(intent: Intent): string {
  const what: Partial<Record<Intent, string>> = {
    check: "check",
    hint: "give a hint for",
    mistake: "look for a mistake in",
    solve: "solve",
    explain: "explain",
    simplify: "explain more simply",
    summarize: "summarise",
    diagram: "describe",
  };
  return `Which part of the page should I ${what[intent] ?? "look at"}? Circle a question or equation with the lasso, then press “Ask AI” — or type the problem here.`;
}
