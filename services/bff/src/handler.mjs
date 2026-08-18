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
import { makeMaterializer } from "./materialize.mjs";
import { makeSettings } from "./settings.mjs";
import { makeChatThreads } from "./chatthreads.mjs";
import { makeEvals } from "./evals.mjs";

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

// Chat thread memory rides on the vault (threads are notes under chat/). Enabled
// whenever the vault is; save/delete need the git writer (else a 503).
let chatThreads = null;
if (vault) {
  chatThreads = makeChatThreads({ vault, retentionDays: config.chatRetentionDays });
}

// Connector connection status, enabled when the shim Lambda prefix is configured.
let connectorStatus = null;
let confluence = null;
let materializer = null;
if (config.connectorPrefix) {
  connectorStatus = await makeConnectorStatus({ region: config.region, prefix: config.connectorPrefix });
  // Confluence search for Flight Planner sources (same shim invocation as status).
  confluence = makeConfluence({ region: config.region, prefix: config.connectorPrefix, siteUrl: config.confluenceSiteUrl });
  // Jira materialize (cleared plan -> epic + stories) when a project is configured.
  if (config.jiraProject) {
    materializer = makeMaterializer({ region: config.region, prefix: config.connectorPrefix, project: config.jiraProject });
  }
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

// Operator settings: write the MC GitHub token to Secrets Manager and restart MC.
// Enabled only when the secret ARN + MC cluster/service are all configured.
let settings = null;
if (config.mcGithubTokenSecretArn && config.mcCluster && config.mcService) {
  settings = makeSettings({
    region: config.region,
    githubTokenSecretArn: config.mcGithubTokenSecretArn,
    cluster: config.mcCluster,
    service: config.mcService,
  });
}

// Eval harness read surface, enabled when the table + bucket are configured.
let evals = null;
if (config.evalTable && config.evalBucket) {
  evals = await makeEvals({ region: config.region, tableName: config.evalTable, bucketName: config.evalBucket });
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
    materializer,
    settings,
    chatThreads,
    evals,
  });
});
