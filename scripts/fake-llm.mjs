// A tiny OpenAI-compatible Chat Completions server for tests. It is NOT a model: it returns
// canned structured answers and *echoes what it was sent*, so tests can assert what the
// backend transmitted (selected region text, injected-document handling, images, ...).
//
// Run:  node scripts/fake-llm.mjs [port]      Debug endpoints: GET /__last, GET /__requests, POST /__reset
// Triggers (put in the student's message): __TIMEOUT__ __AUTH__ __RATE__ __500__ __MALFORMED__ __NOJSONMODE__
import http from "node:http";

export function startFakeLlm(port = 0) {
  const requests = [];

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    if (url.pathname === "/__last") return json(res, 200, requests.at(-1) ?? null);
    if (url.pathname === "/__requests") return json(res, 200, requests);
    if (url.pathname === "/__reset") {
      requests.length = 0;
      return json(res, 200, { ok: true });
    }
    if (!(req.method === "POST" && url.pathname.endsWith("/chat/completions"))) return json(res, 404, { error: { message: "not found" } });

    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || "{}");
    const record = { auth: req.headers.authorization ?? null, body, aborted: false, at: Date.now() };
    requests.push(record);
    res.on("close", () => {
      if (!res.writableEnded) record.aborted = true; // client disconnected before we finished
    });

    const text = flatten(body.messages);
    // Triggers and echoes look only at the latest user turn, like a real conversation would.
    const userText = flatten(body.messages.filter((m) => m.role === "user").slice(-1));

    if (userText.includes("__TIMEOUT__")) return; // hang until the client gives up
    if (userText.includes("__AUTH__")) return json(res, 401, { error: { message: "Incorrect API key provided: sk-secret-should-not-leak" } });
    if (userText.includes("__RATE__")) {
      res.setHeader("Retry-After", "2");
      return json(res, 429, { error: { message: "Rate limit reached" } });
    }
    if (userText.includes("__500__")) return json(res, 503, { error: { message: "overloaded" } });
    if (userText.includes("__NOJSONMODE__") && body.response_format) {
      return json(res, 400, { error: { message: "response_format json_schema is not supported with this model" } });
    }

    const content = userText.includes("__MALFORMED__")
      ? "Sorry — here is some prose instead of JSON: the roots are $x=-2$ and $x=-3$."
      : JSON.stringify(buildAnswer(text, body));

    if (!body.stream) {
      return json(res, 200, { model: body.model, choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 111, completion_tokens: 222 } });
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
    for (let i = 0; i < content.length; i += 14) {
      if (record.aborted) return;
      send({ model: body.model, choices: [{ delta: { content: content.slice(i, i + 14) }, finish_reason: null }] });
      await new Promise((r) => setTimeout(r, 4));
    }
    send({ model: body.model, choices: [{ delta: {}, finish_reason: "stop" }] });
    if (body.stream_options?.include_usage) send({ model: body.model, choices: [], usage: { prompt_tokens: 111, completion_tokens: 222 } });
    res.write("data: [DONE]\n\n");
    res.end();
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ port: addr.port, url: `http://127.0.0.1:${addr.port}/v1`, requests, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

function json(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function flatten(messages) {
  return messages
    .map((m) => (typeof m.content === "string" ? m.content : m.content.map((p) => (p.type === "text" ? p.text : "[image]")).join("\n")))
    .join("\n");
}

const grab = (text, tag) => [...text.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1].trim());

function buildAnswer(text, body) {
  const intent = grab(text, "intent")[0] ?? "general";
  const selected = grab(text, "selected_text")[0] ?? "";
  const page = /<page number="(\d+)"/.exec(text)?.[1] ?? "?";
  const sawImage = body.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"));
  const injection = /ignore previous instructions/i.test(text);
  const structured = Boolean(body.response_format);
  const echo = `Context seen: page ${page}; selected text: “${selected.replace(/\s+/g, " ").slice(0, 160)}”; image: ${sawImage ? "yes" : "no"}; injection present in document: ${injection ? "yes" : "no"}; structured mode: ${structured ? body.response_format.type : "none"}.`;

  const quadratic = /x\^2 \+ 5x \+ 6/.test(selected + text);
  const base = { intent, summary: echo, steps: [], finalAnswer: null, hint: null, mistake: null, graphExpressions: [], pageReferences: [{ page: Number(page) || 1, note: "Source of the selected problem" }], followUps: ["Why does factoring work?"], confidence: "high", needsClarification: null };
  if (intent === "solve" && quadratic) {
    return {
      ...base,
      summary: `We factor the quadratic. ${echo}`,
      steps: [
        { latex: "x^2+5x+6=0", explanation: "Start with the original equation." },
        { latex: "(x+2)(x+3)=0", explanation: "Find two numbers with product $6$ and sum $5$." },
        { latex: "x=-2 \\text{ or } x=-3", explanation: "Set each factor to zero." },
      ],
      finalAnswer: "x=-2 \\text{ or } x=-3",
    };
  }
  if (intent === "hint") return { ...base, hint: "Look for two numbers that multiply to the constant term and add to the middle coefficient." };
  if (intent === "check") return { ...base, mistake: { stepIndex: 1, description: "Expanding $(x+2)(x+4)$ gives $x^2+6x+8$, not $x^2+5x+6$.", correction: "(x+2)(x+3)=0" } };
  return base;
}

// CLI
if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file://").href) {
  const port = Number(process.argv[2] ?? 4010);
  const s = await startFakeLlm(port);
  console.log(`fake LLM listening on ${s.url}`);
}
