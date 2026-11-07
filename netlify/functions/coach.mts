// Bench coach: relays the conversation to Claude and streams the reply back to the page as plain text.
// Credentials come from the environment: set ANTHROPIC_API_KEY in Netlify (Site configuration > Environment variables).
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";
const client = new Anthropic();

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let messages: Anthropic.Beta.BetaMessageParam[];
  try {
    const body = await req.json();
    messages = (Array.isArray(body?.messages) ? body.messages : [])
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim())
      .map((m: any) => ({ role: m.role, content: m.content }));
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!messages.length || messages[messages.length - 1].role !== "user") return Response.json({ error: "No question" }, { status: 400 });

  const stream = client.beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 16000,
      // Chat-style answers: medium effort keeps replies quick. Thinking is always on for this model.
      output_config: { effort: "medium" },
      // If a safety classifier declines, the API re-runs the request on Anthropic's recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      messages,
    },
    { signal: req.signal },
  );

  // Wait for the first event so connection, auth and rate-limit errors become a proper status code for the page.
  const iter = stream[Symbol.asyncIterator]();
  let first: IteratorResult<Anthropic.Beta.BetaRawMessageStreamEvent>;
  try {
    first = await iter.next();
  } catch (e) {
    console.error("coach upstream error", e);
    const rate = e instanceof Anthropic.RateLimitError;
    return Response.json({ error: rate ? "rate_limited" : "upstream_error" }, { status: rate ? 429 : 502 });
  }

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (ev: Anthropic.Beta.BetaRawMessageStreamEvent) => {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") controller.enqueue(enc.encode(ev.delta.text));
      };
      try {
        if (!first.done) emit(first.value);
        for (let r = await iter.next(); !r.done; r = await iter.next()) emit(r.value);
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") controller.enqueue(enc.encode("\n\nThe coach declined to answer that one. Try rephrasing the question."));
        else if (final.stop_reason === "max_tokens") controller.enqueue(enc.encode("\n\n(Answer cut off at the length limit.)"));
      } catch (e) {
        if (!req.signal.aborted) console.error("coach stream error", e);
      }
      controller.close();
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
};

export const config = { path: "/api/coach" };
