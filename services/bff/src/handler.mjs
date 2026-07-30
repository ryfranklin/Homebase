// Lambda entry point.
//
// Exposed via a Lambda Function URL with InvokeMode = RESPONSE_STREAM. Response
// streaming is a Node.js managed-runtime feature (Python has no native Function
// URL streaming path), which is why the BFF is Node.js. The handler is wrapped
// with awslambda.streamifyResponse; the actual logic lives in bff.mjs so it can
// be unit-tested without the Lambda runtime.

import { handleRequest } from "./bff.mjs";
import { loadConfig } from "./config.mjs";
import { invokeAgentRuntimeStream, makeAgentClient } from "./agent.mjs";
import { JwksCache } from "./jwks.mjs";
import { verifyJwt } from "./jwt.mjs";

const config = loadConfig();
const jwks = new JwksCache({ issuer: config.issuer });

let agentClientPromise;
function agentClient() {
  agentClientPromise ??= makeAgentClient(config.region);
  return agentClientPromise;
}

async function verifyToken(token) {
  const keys = await jwks.get();
  return verifyJwt(token, { issuer: config.issuer, audience: config.audience, jwks: keys });
}

function agentStream(args) {
  // Lazy async generator that resolves the client then streams.
  async function* run() {
    const client = await agentClient();
    yield* invokeAgentRuntimeStream(client, args);
  }
  return run();
}

// awslambda.HttpResponseStream.from sets the streamed response status + headers.
function respondFactory(responseStream) {
  return (statusCode, headers) => {
    const stream = awslambda.HttpResponseStream.from(responseStream, { statusCode, headers });
    return {
      write: (chunk) => stream.write(chunk),
      end: () => stream.end(),
    };
  };
}

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  await handleRequest(event, respondFactory(responseStream), { verifyToken, config, agentStream });
});
