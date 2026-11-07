// Bench coach: relays the conversation to Grok through Netlify AI Gateway and streams the reply back as plain text.
const MODEL = "x-ai/grok-4.7";

type Msg = { role: "user" | "assistant"; content: string };

export default async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  let messages: Msg[];
  try {
    const body = await req.json();
    messages = (Array.isArray(body?.messages) ? body.messages : [])
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string")
      .map((m: any) => ({ role: m.role, content: m.content }));
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!messages.length) return Response.json({ error: "No question" }, { status: 400 });

  const gateway = (process.env.NETLIFY_AI_GATEWAY_URL || "").replace(/\/$/, "");
  const upstream = await fetch(`${gateway}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.NETLIFY_AI_GATEWAY_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, stream: true, max_tokens: 2000 }),
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const detail = await upstream.text().catch(() => "");
    console.error("coach upstream error", upstream.status, detail.slice(0, 500));
    return Response.json(
      { error: upstream.status === 429 ? "rate_limited" : "upstream_error" },
      { status: upstream.status === 429 ? 429 : 502 },
    );
  }

  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const reader = upstream.body.getReader();
  const stream = new ReadableStream({
    async start(controller) {
      let buf = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const text = JSON.parse(data)?.choices?.[0]?.delta?.content;
              if (text) controller.enqueue(enc.encode(text));
            } catch {}
          }
        }
      } catch (e) {
        console.error("coach stream error", e);
      }
      controller.close();
    },
    cancel() {
      reader.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
};

export const config = { path: "/api/coach" };
