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
import { makeIdentityClient } from "./identity.mjs";
import { JwksCache } from "./jwks.mjs";
import { verifyJwt } from "./jwt.mjs";
import { cachedOriginSecrets } from "./secrets.mjs";
import { makeVault } from "./vault.mjs";
import { makeVaultDeps } from "./vaultstore.mjs";
import { makeWorkerClient } from "./worker.mjs";
import { makeConnectorStatus } from "./connectorstatus.mjs";
import { makeMissionControl } from "./mission.mjs";
import { makeConfluence } from "./confluence.mjs";

const config = loadConfig();
const jwks = new JwksCache({ issuer: config.issuer });

// Vault workspace: reads from the S3 mirror, writes through the git worker.
let vault = null;
if (config.corpusBucket) {
  const { store } = await makeVaultDeps({
    region: config.region,
    bucket: config.corpusBucket,
    kbId: config.kbId,
    dataSourceId: config.kbDataSourceId,
  });
  // The worker shared secret: a direct value (local/tests) or fetched once from
  // Secrets Manager at cold start (deployed).
  let workerSecret = config.workerSecret;
  if (!workerSecret && config.workerSecretArn) {
    const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({ region: config.region });
    const out = await sm.send(new GetSecretValueCommand({ SecretId: config.workerSecretArn }));
    workerSecret = out.SecretString;
  }
  const writer = config.workerUrl ? makeWorkerClient({ url: config.workerUrl, secret: workerSecret }) : null;
  vault = makeVault({ store, writer });
}

// Connector connection status, enabled when the shim Lambda prefix is configured.
let connectorStatus = null;
let confluence = null;
if (config.connectorPrefix) {
  connectorStatus = await makeConnectorStatus({ region: config.region, prefix: config.connectorPrefix });
  // Confluence search for Flight Planner sources (same shim invocation as status).
  confluence = makeConfluence({ region: config.region, prefix: config.connectorPrefix, siteUrl: config.confluenceSiteUrl });
}

// Mission Control execution seam, enabled when its base URL is configured. The
// bearer token is a direct value (local/tests) or fetched once from Secrets Manager.
let missionControl = null;
if (config.missionUrl) {
  let missionToken = config.missionToken;
  if (!missionToken && config.missionTokenArn) {
    const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
    const sm = new SecretsManagerClient({ region: config.region });
    const out = await sm.send(new GetSecretValueCommand({ SecretId: config.missionTokenArn }));
    missionToken = out.SecretString;
  }
  missionControl = makeMissionControl({ baseUrl: config.missionUrl, token: missionToken });
}

// When the rotating origin secret ARN is configured, load its current/pending
// values from Secrets Manager (cached) so rotation needs no redeploy.
let originSecretsLoader = null;
if (config.originSecretArn) {
  const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
  const sm = new SecretsManagerClient({ region: config.region });
  const client = {
    getSecretValue: (args) => sm.send(new GetSecretValueCommand(args)),
  };
  originSecretsLoader = cachedOriginSecrets(client, config.originSecretArn);
}

let agentClientPromise;
function agentClient() {
  agentClientPromise ??= makeAgentClient(config.region);
  return agentClientPromise;
}

let identityClientPromise;
function identityClient() {
  identityClientPromise ??= makeIdentityClient(config.region);
  return identityClientPromise;
}

async function completeConnectorAuth(args) {
  const client = await identityClient();
  return client.completeResourceTokenAuth(args);
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
  const requestConfig = originSecretsLoader
    ? { ...config, originSharedSecrets: await originSecretsLoader() }
    : config;
  await handleRequest(event, respondFactory(responseStream), {
    verifyToken,
    config: requestConfig,
    agentStream,
    completeConnectorAuth,
    vault,
    connectorStatus,
    missionControl,
    confluence,
  });
});
