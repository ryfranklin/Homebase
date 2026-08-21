// AgentCore runtime invocation, streamed.
//
// InvokeAgentRuntime supports response streaming (SSE) end to end, so the BFF
// streams the agent's tokens and tool-call events straight through. The AWS SDK
// client is created lazily so unit tests inject a fake and make no AWS calls.

const SESSION_HEADER = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id";

// AgentCore requires the runtime session id to be 33..100 chars; a shorter id (e.g. a
// slug-derived plan session like "plan-mc-testflight") 400s the invoke before the agent
// runs. Normalize defensively at the boundary so no client can trip it. Deterministic
// (pad short, clamp long) so the same session keeps the same runtime across turns. Only
// the AgentCore runtimeSessionId is normalized; the payload session_id stays as sent, so
// the agent's memory keying is unchanged.
export function normalizeRuntimeSessionId(id) {
  const s = String(id ?? "");
  return s.length >= 33 ? s.slice(0, 100) : s.padEnd(33, "0");
}

// createAgentStream yields event objects: { type: "token" | "tool_call" |
// "citation" | ..., ... }. The default implementation parses the SSE body of
// InvokeAgentRuntime. Callers pass a session that already carries the verified
// user and tenant, so identity is never taken from the client payload.
export async function* invokeAgentRuntimeStream(client, { runtimeArn, sessionId, userId, tenantId, prompt, mode, model, scope, planContext }) {
  const payload = {
    input: prompt,
    session_id: sessionId,
    user_id: userId,
    tenant_id: tenantId,
    // "plan" runs the agent's AI-DLC interview; otherwise the normal answer mode.
    ...(mode ? { mode } : {}),
    // Optional settings-level model choice; the agent validates it server-side.
    ...(model ? { model } : {}),
    // "vault" restricts the agent to KB + connector sources (no general knowledge).
    ...(scope ? { scope } : {}),
    // The plan being revised (plan mode only): the agent folds it into the turn.
    ...(planContext ? { plan_context: planContext } : {}),
  };

  const runtimeSessionId = normalizeRuntimeSessionId(sessionId);
  const response = await client.invoke({
    agentRuntimeArn: runtimeArn,
    sessionId: runtimeSessionId,
    contentType: "application/json",
    accept: "text/event-stream",
    body: JSON.stringify(payload),
    headers: { [SESSION_HEADER]: runtimeSessionId },
  });

  // response.stream is an async iterable of decoded SSE event objects (the real
  // client adapts the raw byte stream; the fake yields objects directly).
  for await (const event of response.stream) {
    yield event;
  }
}

// Builds the real AWS-SDK-backed client. Imported lazily; not used by tests.
export async function makeAgentClient(region) {
  const { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } = await import(
    "@aws-sdk/client-bedrock-agentcore"
  );
  const sdk = new BedrockAgentCoreClient({ region });

  return {
    async invoke(args) {
      const command = new InvokeAgentRuntimeCommand({
        agentRuntimeArn: args.agentRuntimeArn,
        runtimeSessionId: args.sessionId,
        contentType: args.contentType,
        accept: args.accept,
        payload: Buffer.from(args.body),
      });
      const out = await sdk.send(command);
      return { stream: decodeSseStream(out.response) };
    },
  };
}

// Exported for tests.
// Decodes the agent runtime response into event objects. The agent supports two
// response shapes: an SSE stream of {type,...} events, or (current server) a single
// JSON object {answer, grounded, citations, authorization_url?}. SSE frames are
// yielded as they arrive; a non-SSE JSON body is converted to token + citation
// events once fully read, so the GUI renders it either way.
export async function* decodeSseStream(byteStream) {
  const decoder = new TextDecoder();
  let buffer = "";
  let sawSseEvent = false;

  for await (const chunk of byteStream) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) {
        sawSseEvent = true;
        const json = dataLine.slice("data:".length).trim();
        try {
          yield JSON.parse(json);
        } catch {
          yield { type: "token", text: json };
        }
      }
    }
  }

  // Fallback: a single JSON response (not SSE). Convert it to the GUI's events.
  const rest = buffer.trim();
  if (!sawSseEvent && rest) {
    let obj;
    try {
      obj = JSON.parse(rest);
    } catch {
      yield { type: "token", text: rest };
      return;
    }
    if (obj && typeof obj === "object" && "answer" in obj) {
      yield { type: "token", text: String(obj.answer ?? "") };
      for (const c of obj.citations || []) {
        yield { type: "citation", source_path: c.source_path, score: c.score };
      }
    } else {
      yield { type: "token", text: rest };
    }
  }
}
