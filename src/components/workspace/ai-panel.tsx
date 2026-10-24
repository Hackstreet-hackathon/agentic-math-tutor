"use client";
import { AlertTriangle, ArrowUp, Check, FilePlus2, Headphones, Lightbulb, Loader2, MessageSquarePlus, PenLine, SearchCheck, Sparkles, Square, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Answer, Intent, Verification } from "@/lib/ai/answer";
import type { ChatRequest, ContextSummary } from "@/lib/ai/request";
import { ChatError, getAiStatus, getConversation, streamChat, type AiStatus } from "@/lib/client/ai";
import type { PageDto } from "@/lib/client/api";
import { captureRegionImage } from "@/lib/client/region-image";
import type { Rect } from "@/lib/notebook/geometry";
import type { InkObject, NotebookObject } from "@/lib/notebook/schemas";
import { recognizeStrokes } from "@/lib/notebook/stroke-recognize";
import { cn } from "@/lib/utils";
import type { EditorState } from "./editor";
import { Latex } from "./math";
import { MathText } from "./math-text";
import { useConversation, type TurnPayload } from "./use-conversation";
import { VoiceInput } from "./voice-input";
import { VoiceListener } from "./voice-listener";
import { VoiceOutput } from "./voice-output";

type Item =
  | { id: string; role: "user"; text: string; context?: ContextSummary }
  | { id: string; role: "assistant"; answer: Answer; verification?: Verification; malformed?: boolean; pending?: boolean; sourceQuestion: string; region: Rect | null; messageId?: string }
  | { id: string; role: "error"; text: string; retry?: { text: string; intent?: Intent }; retryAfterSec?: number };

export interface InsertRequest {
  answer: Answer;
  verification: Verification;
  messageId: string;
  sourceQuestion: string;
  region: Rect | null;
}

const ACTIONS: { intent: Intent; label: string; text: string; icon: React.ReactNode }[] = [
  { intent: "explain", label: "Explain", text: "Explain this", icon: <Lightbulb size={14} /> },
  { intent: "solve", label: "Solve", text: "Solve this step by step", icon: <Wand2 size={14} /> },
  { intent: "check", label: "Check my work", text: "Check my work", icon: <SearchCheck size={14} /> },
  { intent: "hint", label: "Give me a hint", text: "Give me a hint", icon: <PenLine size={14} /> },
];

const INTENT_LABEL: Partial<Record<Intent, string>> = {
  explain: "Explanation",
  solve: "Solution",
  check: "Check",
  hint: "Hint",
  mistake: "Mistake",
  simplify: "Simpler explanation",
  graph: "Graph",
  insert: "Solution",
  diagram: "Diagram",
  summarize: "Summary",
  followup: "Follow-up",
};

export function AiPanel(props: {
  notebookId: string;
  page: PageDto;
  pageCount: number;
  editor: EditorState;
  textSelection: string;
  onClearSelection: () => void;
  onGoToPageNumber: (n: number) => void;
  onInsertSolution: (req: InsertRequest) => Promise<boolean>;
  /** Called before every AI request so unsaved ink/objects reach the server's context builder. */
  onFlushSave: () => Promise<void>;
  focusSignal: number;
  /** A question the workspace wants asked right away (e.g. "Show me" on a flagged step). */
  autoAsk?: { nonce: number; text: string; intent?: Intent; /** The student circled something: the tutor takes the lead and asks about it. */ lasso?: boolean } | null;
  onClose: () => void;
}) {
  const { notebookId, page, editor, textSelection } = props;
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [voiceActive, setVoiceActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const nextId = () => `m${++seq.current}`;

  /* ----- load status + history once ----- */
  useEffect(() => {
    let cancelled = false;
    getAiStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus({ configured: false, reason: "Could not reach the server." }));
    getConversation(notebookId)
      .then((c) => {
        if (cancelled || !c) return;
        setConversationId(c.id);
        setItems(
          c.messages.flatMap<Item>((m) => {
            if (m.role === "USER") return [{ id: m.id, role: "user", text: m.content, context: m.contextMeta?.pageNumber ? (m.contextMeta as ContextSummary) : undefined }];
            if (m.role === "ASSISTANT" && m.structured) {
              return [{ id: m.id, role: "assistant", answer: m.structured.answer, verification: m.structured.verification, malformed: m.structured.malformed, sourceQuestion: "", region: null, messageId: m.id }];
            }
            // Spoken (voice conversation) replies have no structured answer: show them as plain text.
            if (m.role === "ASSISTANT") {
              return [{ id: m.id, role: "assistant", answer: { ...emptyAnswer("followup"), summary: m.content }, sourceQuestion: "", region: null, messageId: m.id }];
            }
            return [];
          }),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [notebookId]);

  useEffect(() => {
    if (props.focusSignal > 0) inputRef.current?.focus();
  }, [props.focusSignal]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [items]);

  /* ----- selection indicator ----- */
  const selection = useMemo(() => {
    const parts: string[] = [];
    if (editor.region) parts.push(editor.region.kind === "lasso" ? "Circled region" : "Boxed region");
    if (editor.selectedIds.length) parts.push(`${editor.selectedIds.length} object${editor.selectedIds.length === 1 ? "" : "s"}`);
    if (textSelection) parts.push(`“${textSelection.length > 36 ? textSelection.slice(0, 36) + "…" : textSelection}”`);
    return parts;
  }, [editor.region, editor.selectedIds.length, textSelection]);
  const hasSelection = selection.length > 0;

  /* ----- what the student has circled / selected, packaged for the tutor ----- */
  const buildSelectionPayload = useCallback((): TurnPayload => {
    const region = editor.region;
    const selectionIds = new Set(editor.selectedIds);
    const hasInk = page.objects.some((o) => o.type === "INK" && selectionIds.has(o.id));
    let image: string | null = null;
    if (region && status?.capabilities?.vision && (page.pageType === "PDF" || hasInk)) {
      const pdfCanvas = document.querySelector<HTMLCanvasElement>('[data-testid="pdf-background"] canvas');
      image = captureRegionImage({ page, bounds: region.bounds, objects: page.objects, pdfCanvas });
    }
    const inkObjects = (page.objects as NotebookObject[]).filter((o): o is InkObject => o.type === "INK" && selectionIds.has(o.id));
    let recognizedHandwriting: string | undefined;
    try {
      recognizedHandwriting = (inkObjects.length > 0 ? recognizeStrokes(inkObjects) : null)?.latex ?? undefined;
    } catch {
      recognizedHandwriting = undefined; // best-effort only
    }
    return {
      selection: hasSelection
        ? { region: region ? { kind: region.kind, polygon: region.polygon, bounds: region.bounds } : null, objectIds: editor.selectedIds, text: textSelection || null }
        : null,
      image,
      recognizedHandwriting,
    };
  }, [editor.region, editor.selectedIds, hasSelection, page, status, textSelection]);

  /* ----- voice conversation ----- */
  const [convoOn, setConvoOn] = useState(false);
  const [convoError, setConvoError] = useState<string | null>(null);
  const [sayText, setSayText] = useState("");
  const tutorItemId = useRef<string | null>(null);
  const convo = useConversation({
    active: convoOn && Boolean(status?.configured),
    notebookId,
    pageId: page.id,
    conversationId,
    onConversationId: setConversationId,
    getPayload: async () => {
      await props.onFlushSave();
      return buildSelectionPayload();
    },
    onUser: (text) => {
      setConvoError(null);
      setItems((prev) => [...prev, { id: nextId(), role: "user", text }]);
    },
    onTutorStart: () => {
      const id = nextId();
      tutorItemId.current = id;
      setItems((prev) => [...prev, { id, role: "assistant", pending: true, answer: emptyAnswer("followup"), sourceQuestion: "", region: editor.region?.bounds ?? null }]);
    },
    onTutorText: (text) => setItems((prev) => prev.map((it) => (it.id === tutorItemId.current && it.role === "assistant" ? { ...it, answer: { ...it.answer, summary: text } } : it))),
    onTutorDone: () => setItems((prev) => prev.map((it) => (it.id === tutorItemId.current && it.role === "assistant" ? { ...it, pending: false } : it))),
    onError: (message) => setConvoError(message),
    onStopListening: () => setConvoOn(false),
  });

  /* ----- sending ----- */
  const send = useCallback(
    async (text: string, intent?: Intent) => {
      const message = text.trim();
      if (!message || !status?.configured) return;
      abortRef.current?.abort(); // a newer question makes the older one obsolete
      const ac = new AbortController();
      abortRef.current = ac;

      // Flush unsaved objects so the server's context builder can find them in the DB.
      await props.onFlushSave();

      const region = editor.region;
      const selectionIds = new Set(editor.selectedIds);
      const hasInk = page.objects.some((o) => o.type === "INK" && selectionIds.has(o.id));
      let image: string | null = null;
      if (region && status.capabilities?.vision && (page.pageType === "PDF" || hasInk)) {
        const pdfCanvas = document.querySelector<HTMLCanvasElement>('[data-testid="pdf-background"] canvas');
        image = captureRegionImage({ page, bounds: region.bounds, objects: page.objects, pdfCanvas });
      }

      // Run client-side stroke recognition on selected ink objects.
      const inkObjects = (page.objects as NotebookObject[]).filter(
        (o): o is InkObject => o.type === "INK" && selectionIds.has(o.id),
      );
      let recognizedHandwriting: string | undefined;
      try {
        const recognized = inkObjects.length > 0 ? recognizeStrokes(inkObjects) : null;
        recognizedHandwriting = recognized?.latex ?? undefined;
      } catch {
        // Recognition is best-effort; never block the AI request on errors.
        recognizedHandwriting = undefined;
      }

      const body: ChatRequest = {
        notebookId,
        pageId: page.id,
        conversationId,
        message,
        intent,
        selection: hasSelection
          ? { region: region ? { kind: region.kind, polygon: region.polygon, bounds: region.bounds } : null, objectIds: editor.selectedIds, text: textSelection || null }
          : null,
        image,
        recognizedHandwriting,
      };

      const userId = nextId();
      const pendingId = nextId();
      setItems((prev) => [
        ...prev,
        { id: userId, role: "user", text: message },
        { id: pendingId, role: "assistant", pending: true, answer: emptyAnswer(intent), sourceQuestion: message, region: region?.bounds ?? null },
      ]);
      setInput("");
      setBusy(true);

      try {
        const final = await streamChat(
          body,
          {
            onMeta: (m) => {
              setConversationId(m.conversationId);
              setItems((prev) => prev.map((it) => (it.id === userId && it.role === "user" ? { ...it, context: m.context } : it)));
            },
            onPartial: (a) => setItems((prev) => prev.map((it) => (it.id === pendingId && it.role === "assistant" ? { ...it, answer: a } : it))),
          },
          ac.signal,
        );
        setItems((prev) =>
          prev.map((it) =>
            it.id === pendingId && it.role === "assistant"
              ? { ...it, pending: false, answer: final.answer, verification: final.verification, malformed: final.malformed, messageId: final.messageId }
              : it,
          ),
        );
        // Auto-insert solution onto the page when the answer has content
        if (final.answer.steps.some((s) => s.latex) || final.answer.finalAnswer) {
          void props.onInsertSolution({
            answer: final.answer,
            verification: final.verification ?? { status: "UNSUPPORTED" },
            messageId: final.messageId,
            sourceQuestion: message,
            region: region?.bounds ?? null,
          });
        }
      } catch (e) {
        if ((e as Error).name === "AbortError") {
          setItems((prev) => prev.filter((it) => it.id !== pendingId));
        } else {
          const err = e as ChatError;
          setItems((prev) => [
            ...prev.filter((it) => it.id !== pendingId),
            { id: nextId(), role: "error", text: err.message || "Something went wrong.", retryAfterSec: err.retryAfterSec, retry: { text, intent } },
          ]);
        }
      } finally {
        if (abortRef.current === ac) setBusy(false);
      }
    },
    [status, editor.region, editor.selectedIds, hasSelection, page, notebookId, conversationId, textSelection, props.onFlushSave],
  );

  const lastAutoAsk = useRef(0);
  const autoAsk = props.autoAsk;
  useEffect(() => {
    if (!autoAsk || autoAsk.nonce === lastAutoAsk.current || !status?.configured) return;
    lastAutoAsk.current = autoAsk.nonce;
    // Deferred so the request starts after this render has committed (the panel may have just mounted).
    setTimeout(() => {
      if (autoAsk.lasso) convo.lasso();
      else void send(autoAsk.text, autoAsk.intent);
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk, status?.configured]);

  const stop = () => abortRef.current?.abort();
  const newChat = () => {
    abortRef.current?.abort();
    setItems([]);
    setConversationId(null);
    setBusy(false);
  };

  /* ----- render ----- */
  const unavailable = status && !status.configured;

  return (
    <aside aria-label="AI tutor" data-testid="ai-panel" className="fixed inset-y-0 right-0 z-30 flex w-full max-w-[400px] flex-col border-l border-line bg-white shadow-xl md:static md:z-auto md:w-[380px] md:max-w-none md:shrink-0 md:shadow-none">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-3">
        <Sparkles size={16} className="text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">AI tutor</p>
          {status?.configured && <p className="truncate text-[11px] leading-tight text-muted">{status.model}</p>}
        </div>
        {status?.configured && (
          <button
            data-testid="convo-toggle"
            aria-pressed={convoOn}
            aria-label={convoOn ? "Stop voice conversation" : "Start voice conversation"}
            title={convoOn ? "Stop voice conversation" : "Talk with the tutor (always listening)"}
            onClick={() => {
              setConvoError(null);
              setConvoOn((v) => !v);
            }}
            className={cn("flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium", convoOn ? "bg-accent text-white" : "hover:bg-black/5")}
          >
            <Headphones size={15} />
            {convoOn ? "Talking" : "Talk"}
          </button>
        )}
        <button aria-label="New conversation" title="New conversation" onClick={newChat} disabled={items.length === 0} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5 disabled:opacity-30">
          <MessageSquarePlus size={16} />
        </button>
        <button aria-label="Close AI tutor" onClick={props.onClose} className="grid h-8 w-8 place-items-center rounded-lg hover:bg-black/5">
          <X size={16} />
        </button>
      </header>

      <div ref={logRef} role="log" aria-live="polite" aria-label="Conversation" className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {status === null && <p className="py-8 text-center text-sm text-muted">Loading…</p>}
        {unavailable && (
          <div data-testid="ai-unavailable" className="rounded-xl border border-line bg-surface p-4 text-sm">
            <p className="font-medium">The AI tutor isn’t set up on this server</p>
            <p className="mt-1 text-muted">Your notebook, PDFs, drawing, equations and export all work without it. An administrator can enable the tutor by configuring an AI provider (see the README).</p>
            {status?.reason && <p className="mt-2 rounded bg-black/5 px-2 py-1 font-mono text-[11px] text-muted">{status.reason}</p>}
          </div>
        )}
        {status?.configured && items.length === 0 && (
          <div className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
            <p className="font-medium text-ink">Ask about what’s on the page</p>
            <p className="mt-1">Circle a question with the lasso and press <strong className="font-medium text-ink">Ask AI</strong>, or select text in a PDF. I’ll only use the part you point at.</p>
          </div>
        )}
        {items.map((it) =>
          it.role === "user" ? (
            <UserBubble key={it.id} text={it.text} context={it.context} />
          ) : it.role === "error" ? (
            <ErrorCard key={it.id} text={it.text} retry={it.retry ? () => void send(it.retry!.text, it.retry!.intent) : undefined} retryAfterSec={it.retryAfterSec} />
          ) : (
            <AnswerCard
              key={it.id}
              item={it}
              pageCount={props.pageCount}
              onGoToPage={props.onGoToPageNumber}
              onFollowUp={(q) => void send(q, "followup")}
              onInsert={async () => {
                if (!it.messageId) return false;
                return props.onInsertSolution({ answer: it.answer, verification: it.verification ?? { status: "UNSUPPORTED" }, messageId: it.messageId, sourceQuestion: it.sourceQuestion, region: it.region });
              }}
            />
          ),
        )}
      </div>

      <footer className="shrink-0 space-y-2 border-t border-line p-3">
        <div className="flex flex-wrap items-center gap-1.5" data-testid="selection-indicator">
          {hasSelection ? (
            <span className="flex max-w-full items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-1 text-xs text-accent">
              <span className="truncate">
                Page {page.position + 1} · {selection.join(" · ")}
              </span>
              <button aria-label="Clear selection" onClick={props.onClearSelection} className="rounded-full hover:bg-white/60">
                <X size={12} />
              </button>
            </span>
          ) : (
            <span className="text-xs text-muted">Nothing selected — ask in general, or circle something first.</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ACTIONS.map((a) => (
            <button
              key={a.intent}
              disabled={!status?.configured || busy || !hasSelection}
              onClick={() => void send(a.text, a.intent)}
              title={hasSelection ? a.text : "Circle or select something first"}
              data-testid={`action-${a.intent}`}
              className="flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs hover:bg-surface disabled:cursor-not-allowed disabled:opacity-40"
            >
              {a.icon} {a.label}
            </button>
          ))}
        </div>
        {convoOn && (
          <div data-testid="convo-bar" className="mb-2 rounded-xl bg-accent-soft px-3 py-2 text-xs text-accent">
            <div className="flex items-center gap-2">
              <span data-testid="convo-state" className="font-medium">
                {{ off: "Starting…", listening: "Listening — just talk", hearing: "Hearing you…", transcribing: "Got it…", thinking: "Thinking…", speaking: "Speaking — talk to interrupt" }[convo.state]}
              </span>
              <span className="ml-auto truncate text-accent/80" title="The tutor sees what you have circled or selected">
                {hasSelection ? `Using: ${selection.join(", ")}` : "Circle an equation to ask about it"}
              </span>
            </div>
            {convoError && <p role="alert" className="mt-1 text-red-700">{convoError}</p>}
            <input
              data-testid="convo-say"
              value={sayText}
              onChange={(e) => setSayText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  convo.say(sayText);
                  setSayText("");
                }
              }}
              placeholder="…or type what you would say"
              className="mt-1.5 w-full rounded-lg border border-accent/20 bg-white px-2 py-1 text-xs text-ink outline-none placeholder:text-muted"
            />
          </div>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
        >
          {!convoOn && <VoiceListener
            active={voiceActive}
            onToggle={() => setVoiceActive((v) => !v)}
            onMathQuestion={(text) => {
              setInput(text);
              void send(text);
            }}
          />}
          <textarea
            ref={inputRef}
            data-testid="ai-input"
            aria-label="Ask the AI tutor"
            value={input}
            rows={2}
            maxLength={4000}
            disabled={!status?.configured}
            placeholder={status?.configured ? "Ask a question…" : "AI tutor unavailable"}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            className="min-h-[2.5rem] flex-1 resize-none rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-accent disabled:bg-surface"
          />
          <VoiceInput
            onTranscript={(text) => setInput((prev) => prev ? prev + " " + text : text)}
            disabled={!status?.configured}
          />
          {busy ? (
            <button type="button" aria-label="Stop" onClick={stop} data-testid="ai-stop" className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-white">
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" aria-label="Send" data-testid="ai-send" disabled={!input.trim() || !status?.configured} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink text-white disabled:opacity-30">
              <ArrowUp size={16} />
            </button>
          )}
        </form>
      </footer>
    </aside>
  );
}

const emptyAnswer = (intent?: Intent): Answer => ({
  intent: intent ?? "general",
  summary: "",
  steps: [],
  finalAnswer: null,
  hint: null,
  mistake: null,
  graphExpressions: [],
  pageReferences: [],
  followUps: [],
  confidence: "medium",
  needsClarification: null,
});

function UserBubble({ text, context }: { text: string; context?: ContextSummary }) {
  const used: string[] = [];
  if (context) {
    if (context.selectedTextChars) used.push("selected text");
    if (context.selectedObjects) used.push(`${context.selectedObjects} object${context.selectedObjects === 1 ? "" : "s"}`);
    if (context.nearbyTextChars) used.push("nearby text");
    if (context.imageSent) used.push("image of selection");
    for (const r of context.references) used.push(`page ${r.page}`);
  }
  return (
    <div className="flex flex-col items-end gap-1" data-testid="user-message">
      <div className="max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-ink px-3 py-2 text-sm text-white">{text}</div>
      {context && (
        <p className="max-w-[90%] text-right text-[11px] text-muted" data-testid="context-used">
          {used.length > 0 ? `Used: ${used.join(" · ")}` : "No page content was used"}
          {context.imageSkipped === "no_vision" && " · image skipped (this model can’t read images)"}
          {context.scannedPageNoText && " · scanned page (no text layer)"}
        </p>
      )}
    </div>
  );
}

function ErrorCard({ text, retry, retryAfterSec }: { text: string; retry?: () => void; retryAfterSec?: number }) {
  return (
    <div role="alert" data-testid="ai-error" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <p className="flex items-start gap-2">
        <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{text}</span>
      </p>
      {retry && (
        <button onClick={retry} className="mt-2 rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs hover:bg-red-100">
          Try again{retryAfterSec ? ` (in ~${retryAfterSec}s)` : ""}
        </button>
      )}
    </div>
  );
}

function AnswerCard({
  item,
  pageCount,
  onGoToPage,
  onFollowUp,
  onInsert,
}: {
  item: Extract<Item, { role: "assistant" }>;
  pageCount: number;
  onGoToPage: (n: number) => void;
  onFollowUp: (q: string) => void;
  onInsert: () => Promise<boolean>;
}) {
  const { answer: a, pending } = item;
  const [inserted, setInserted] = useState<"idle" | "busy" | "done">("idle");
  const canInsert = !pending && (a.steps.some((s) => s.latex) || a.finalAnswer);
  const verified = item.verification?.status === "VERIFIED";
  const empty = !a.summary && a.steps.length === 0 && !a.finalAnswer && !a.hint && !a.mistake && !a.needsClarification;

  return (
    <article data-testid="ai-answer" aria-busy={pending} className="rounded-2xl rounded-bl-md border border-line bg-surface p-3 text-sm">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">{INTENT_LABEL[a.intent] ?? "Answer"}</span>
        {!pending && (
          <span className={cn("rounded-full px-2 py-0.5", verified ? "bg-green-100 text-green-800" : "bg-black/5 text-muted")} title={item.verification?.note}>
            {verified ? "Verified ✓" : "AI-generated · not verified"}
          </span>
        )}
        {item.malformed && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Unstructured reply</span>}
        {!pending && a.confidence === "low" && !item.malformed && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">Low confidence</span>}
      </div>

      {pending && empty && (
        <p className="flex items-center gap-2 text-muted">
          <Loader2 size={14} className="animate-spin" /> Thinking…
        </p>
      )}
      {a.needsClarification && <p data-testid="clarification" className="font-medium"><MathText text={a.needsClarification} /></p>}
      {a.summary && (
        <p className="leading-relaxed">
          <MathText text={a.summary} />
        </p>
      )}
      {a.steps.length > 0 && (
        <ol className="mt-2 space-y-2">
          {a.steps.map((s, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white text-[11px] text-muted ring-1 ring-line">{i + 1}</span>
              <div className="min-w-0 flex-1">
                {s.latex && <div className="overflow-x-auto text-[15px]"><Latex latex={s.latex} /></div>}
                {s.explanation && <p className="text-muted"><MathText text={s.explanation} /></p>}
              </div>
            </li>
          ))}
        </ol>
      )}
      {a.finalAnswer && (
        <div className="mt-2 rounded-lg bg-white px-3 py-2 ring-1 ring-line" data-testid="final-answer">
          <span className="mr-2 text-[11px] font-medium uppercase tracking-wide text-muted">Answer</span>
          <Latex latex={a.finalAnswer} />
        </div>
      )}
      {a.hint && (
        <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-950 ring-1 ring-amber-200" data-testid="hint">
          <span className="mr-1 font-medium">Hint:</span>
          <MathText text={a.hint} />
        </div>
      )}
      {a.mistake && (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-950 ring-1 ring-red-200" data-testid="mistake">
          <p className="font-medium">{a.mistake.stepIndex ? `Check step ${a.mistake.stepIndex}` : "Possible mistake"}</p>
          <p className="whitespace-normal break-words"><MathText text={a.mistake.description} /></p>
          {a.mistake.correction && (
            <p className="mt-1 whitespace-normal break-words text-green-900">
              <span className="font-medium">Try: </span>
              <MathText text={a.mistake.correction} />
            </p>
          )}
        </div>
      )}
      {a.pageReferences.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {a.pageReferences.map((r, i) => {
            const ok = r.page >= 1 && r.page <= pageCount;
            return (
              <button key={i} disabled={!ok} onClick={() => onGoToPage(r.page)} title={r.note} className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] hover:bg-surface disabled:opacity-50">
                Page {r.page}
              </button>
            );
          })}
        </div>
      )}
      {!pending && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {canInsert && (
            <button
              data-testid="insert-solution"
              disabled={inserted === "busy" || inserted === "done"}
              onClick={async () => {
                setInserted("busy");
                setInserted((await onInsert()) ? "done" : "idle");
              }}
              className="flex items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {inserted === "done" ? <Check size={13} /> : inserted === "busy" ? <Loader2 size={13} className="animate-spin" /> : <FilePlus2 size={13} />}
              {inserted === "done" ? "Added to page" : "Write on page"}
            </button>
          )}
          {a.followUps.map((q, i) => (
            <button key={i} onClick={() => onFollowUp(q)} className="rounded-full border border-line bg-white px-2.5 py-1 text-xs hover:bg-surface">
              {q}
            </button>
          ))}
          {!pending && (a.steps.length > 0 || a.finalAnswer) && (
            <VoiceOutput steps={a.steps} finalAnswer={a.finalAnswer} />
          )}
        </div>
      )}
    </article>
  );
}
