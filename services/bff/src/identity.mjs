// AgentCore Identity client used to finalize a connector's 3LO consent.
//
// After the user completes consent in the browser, AgentCore redirects back with
// a session_id. CompleteResourceTokenAuth confirms that session and promotes the
// resulting OAuth token into the durable vault, so the connector shim can then
// fetch it headlessly. The AWS SDK client is created lazily and injected in tests,
// so importing this module makes no AWS calls.

// Builds the real AWS-SDK-backed identity client. Imported lazily; not used by tests.
export async function makeIdentityClient(region) {
  const { BedrockAgentCoreClient, CompleteResourceTokenAuthCommand } = await import(
    "@aws-sdk/client-bedrock-agentcore"
  );
  const sdk = new BedrockAgentCoreClient({ region });

  return {
    // userId is the AgentCore user identity the 3LO flow was initiated for (the
    // tenant id, matching the connector shim); sessionUri is the session_id the
    // browser returned with.
    async completeResourceTokenAuth({ userId, sessionUri }) {
      await sdk.send(
        new CompleteResourceTokenAuthCommand({
          userIdentifier: { userId },
          sessionUri,
        }),
      );
    },
  };
}
