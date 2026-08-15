// Materialize a cleared flight plan into Jira: an epic (the plan) + a story per unit,
// created through the write-gated jira.create_issue on the atlassian connector shim.
// Every write is a two-hop confirm: invoke -> confirmation contract (token) ->
// re-invoke with the token -> the issue is created. The BFF drives both hops, so the
// "Materialize to Jira" click is the deliberate human confirmation.

// Minimal Atlassian Document Format from plain text (one paragraph per non-empty line).
export function adf(text) {
  const paras = String(text || "")
    .split(/\n{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
  const content = (paras.length ? paras : [""]).map((p) => ({ type: "paragraph", content: [{ type: "text", text: p }] }));
  return { type: "doc", version: 1, content };
}

// Epic description: objective + context + the approved acceptance criteria (the DoD).
export function epicDescription(plan) {
  const parts = [];
  if (plan.objective) parts.push(plan.objective);
  if (plan.context) parts.push(plan.context);
  const dod = (plan.criteria || []).filter((c) => c.status === "approved").map((c) => `- ${c.statement}`);
  if (dod.length) parts.push("Definition of done:\n" + dod.join("\n"));
  return parts.join("\n\n");
}

function waypointTitle(wp) {
  return typeof wp === "string" ? wp : wp?.title || "unit";
}

export function makeMaterializer({ region, prefix, project }) {
  let lambdaPromise = null;
  async function client() {
    if (!lambdaPromise) {
      lambdaPromise = import("@aws-sdk/client-lambda").then(({ LambdaClient, InvokeCommand }) => ({
        lambda: new LambdaClient({ region }),
        InvokeCommand,
      }));
    }
    return lambdaPromise;
  }

  async function invoke(args) {
    const { lambda, InvokeCommand } = await client();
    const out = await lambda.send(
      new InvokeCommand({
        FunctionName: `${prefix}-connector-atlassian`,
        Payload: Buffer.from(JSON.stringify({ name: "jira_create_issue", arguments: args })),
      }),
    );
    return JSON.parse(Buffer.from(out.Payload ?? Buffer.from("{}")).toString("utf8"));
  }

  // The two-hop gated create: returns the Jira issue { id, key, self }.
  async function createIssue(tenantId, fields) {
    const base = { fields, tenant_id: tenantId };
    const first = await invoke(base);
    if (first?.requires_authorization) {
      const err = new Error("atlassian not linked");
      err.code = "authorization_required";
      err.authorization_url = first.authorization_url ?? null;
      throw err;
    }
    if (first?.requires_confirmation === false) return first.result; // (no gate; unlikely for a write)
    const token = first?.confirmation_token;
    if (!token) throw new Error("no confirmation token from the connector");
    const second = await invoke({ ...base, confirmation_token: token });
    if (second?.requires_confirmation) throw new Error("jira create was not confirmed");
    return second.result;
  }

  return {
    // Create the epic + a story per route unit (fallback: per approved AC). Returns
    // { project, epic, stories: [{ key, title }] } for the caller to record on the plan.
    async materialize(tenantId, plan, projectKey = project) {
      if (!projectKey) throw Object.assign(new Error("no Jira project configured"), { status: 400, code: "no_project" });

      const epic = await createIssue(tenantId, {
        project: { key: projectKey },
        issuetype: { name: "Epic" },
        summary: plan.title || "Flight plan",
        description: adf(epicDescription(plan)),
      });
      const epicKey = epic?.key;

      const units =
        (plan.route || []).length > 0
          ? (plan.route || []).map(waypointTitle)
          : (plan.criteria || []).filter((c) => c.status === "approved").map((c) => c.statement);

      const stories = [];
      for (const title of units) {
        const issue = await createIssue(tenantId, {
          project: { key: projectKey },
          issuetype: { name: "Story" },
          summary: title,
          description: adf(`From flight plan: ${plan.title || ""}`),
          ...(epicKey ? { parent: { key: epicKey } } : {}),
        });
        if (issue?.key) stories.push({ key: issue.key, title });
      }

      return { project: projectKey, epic: epicKey, stories };
    },
  };
}
