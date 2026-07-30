// AgentCore runtime invocation, streamed.
//
// InvokeAgentRuntime supports response streaming (SSE) end to end, so the BFF
// streams the agent's tokens and tool-call events straight through. The AWS SDK
// client is created lazily so unit tests inject a fake and make no AWS calls.

const SESSION_HEADER = "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id";

// createAgentStream yields event objects: { type: "token" | "tool_call" |
// "citation" | ..., ... }. The default implementation parses the SSE body of
// InvokeAgentRuntime. Callers pass a session that already carries the verified
// user and tenant, so identity is never taken from the client payload.
export async function* invokeAgentRuntimeStream(client, { runtimeArn, sessionId, userId, tenantId, prompt }) {
  const payload = {
    input: prompt,
    session_id: sessionId,
    user_id: userId,
    tenant_id: tenantId,
  };

  const response = await client.invoke({
    agentRuntimeArn: runtimeArn,
    sessionId,
    contentType: "application/json",
    accept: "text/event-stream",
    body: JSON.stringify(payload),
    headers: { [SESSION_HEADER]: sessionId },
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

// Decodes a raw SSE byte stream into event objects.
async function* decodeSseStream(byteStream) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of byteStream) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const dataLine = rawEvent.split("\n").find((l) => l.startsWith("data:"));
      if (dataLine) {
        const json = dataLine.slice("data:".length).trim();
        try {
          yield JSON.parse(json);
        } catch {
          yield { type: "token", text: json };
        }
      }
    }
  }
}
