// Client for the Mission Control HTTP seam. Mission Control is the execution engine:
// Homebase (the planner) hands it a unit of a cleared flight plan as a RUN, watches
// priced telemetry over SSE, and drives the go/no-go gate from Homebase's review
// gate. Reads are open; mutations carry a bearer token. Kept out of bff.mjs so that
// stays testable; the base URL + token are injected here.
//
// Seam contract (flight-plan unit -> Mission Control run):
//   POST /runs  { target, task_type, prompt, acceptance_criteria?, slack_profile? }  -> RunDetail
//   task_type is derived from the unit's AI-DLC phase:
//     INCEPTION   -> "sim"  (read-only investigation; never mutates the repo)
//     CONSTRUCTION-> "burn"  (side-effectful; pauses at the gate for approval)
// A burn run pauses at Mission Control's go/no-go gate; Homebase approves/rejects it
// through the same "governed on commit" review gate the flight-plan schema defines.
// acceptance_criteria carries the plan's approved criteria as structured strings so
// Mission Control's verification node can score the burn's output against them (the
// same criteria already embedded in the prompt as the definition of done).

// The approved acceptance-criteria statements for a plan: the plan-wide definition of
// done. Sent structured across the seam so Mission Control's verify node can judge the
// output against them, and embedded in the worker prompt. One source, two uses.
export function acceptanceCriteria(plan) {
  return (plan.criteria || []).filter((c) => c.status === "approved").map((c) => c.statement);
}

// The acceptance criteria a single unit is judged against: the unit's OWN definition of
// done when it carries one, else the plan's approved criteria. So a unit can scope (or
// tighten) what "done" means for it, and units without their own criteria inherit the
// plan-wide DoD (the prior behavior). This is the single resolver the seam + prompt share.
export function unitAcceptanceCriteria(plan, unit) {
  const own = unit && Array.isArray(unit.criteria) ? unit.criteria.filter((s) => String(s).trim()) : [];
  return own.length ? own.map(String) : acceptanceCriteria(plan);
}

// The unit shape Homebase sends across the seam (a normalized flight-plan waypoint).
// Kept minimal and explicit so the mapping is the whole contract.
export function mapUnitToLaunch(plan, unit) {
  const phase = String(unit.phase || "CONSTRUCTION").toUpperCase();
  const task_type = phase === "INCEPTION" ? "sim" : "burn";
  return {
    target: plan.target,
    task_type,
    prompt: buildPrompt(plan, unit),
    acceptance_criteria: unitAcceptanceCriteria(plan, unit),
    slack_profile: plan.slackProfile ?? null,
  };
}

// Compose the worker prompt from the plan's narrative and the unit, plus the unit's
// acceptance criteria (its own, else the plan's approved) as the definition of done.
// Deterministic so the same plan+unit always produces the same instruction.
export function buildPrompt(plan, unit) {
  const lines = [];
  lines.push(`# ${unit.title}`);
  if (plan.title) lines.push("", `Flight plan: ${plan.title}`);
  if (plan.objective) lines.push("", `## Objective`, plan.objective);
  if (plan.context) lines.push("", `## Context`, plan.context);
  const dod = unitAcceptanceCriteria(plan, unit).map((s) => `- ${s}`);
  if (dod.length) lines.push("", `## Definition of done (acceptance criteria)`, ...dod);
  if (unit.instruction) lines.push("", `## This unit`, unit.instruction);
  return lines.join("\n");
}

export function makeMissionControl({ baseUrl, token = null, fetchImpl = fetch }) {
  const base = baseUrl.replace(/\/$/, "");
  const authHeader = token ? { authorization: `Bearer ${token}` } : {};

  async function request(method, path, { body, stream = false } = {}) {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(stream ? { accept: "text/event-stream" } : {}),
        ...authHeader,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`mission-control ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
      err.status = res.status === 404 ? 404 : 502;
      err.code = "mission_control_error";
      throw err;
    }
    return stream ? res : res.json();
  }

  return {
    // Launch a run for one flight-plan unit. plan/unit are the seam contract shapes.
    async launchUnit(plan, unit) {
      return request("POST", "/runs", { body: mapUnitToLaunch(plan, unit) });
    },
    // Launch a raw run (escape hatch / prototype): the caller supplies the MC shape.
    async launch({ target, task_type, prompt, acceptance_criteria = null, slack_profile = null }) {
      return request("POST", "/runs", {
        body: { target, task_type, prompt, acceptance_criteria, slack_profile },
      });
    },
    async get(runId) {
      return request("GET", `/runs/${encodeURIComponent(runId)}`);
    },
    async list({ status, target, limit = 50, offset = 0, order = "desc" } = {}) {
      const q = new URLSearchParams({ limit: String(limit), offset: String(offset), order });
      if (status) q.set("status", status);
      if (target) q.set("target", target);
      return request("GET", `/runs?${q}`);
    },
    async changes(runId) {
      return request("GET", `/runs/${encodeURIComponent(runId)}/changes`);
    },
    // Go/no-go gate, driven from Homebase's review gate. decision is "approve" |
    // "reject" (also "scrub" to kill, "cancel" to stop an in-flight run).
    async decide(runId, decision) {
      const allowed = new Set(["approve", "reject", "scrub", "cancel"]);
      if (!allowed.has(decision)) {
        throw Object.assign(new Error(`invalid decision: ${decision}`), { status: 400, code: "invalid_decision" });
      }
      return request("POST", `/runs/${encodeURIComponent(runId)}/${decision}`);
    },
    // Live telemetry: async generator over the SSE feed (node_transition, step_metric,
    // gate_waiting). lastEventId resumes after a drop. Yields { event, data }.
    async *events(runId, { lastEventId } = {}) {
      const q = lastEventId ? `?last_event_id=${encodeURIComponent(lastEventId)}` : "";
      const res = await request("GET", `/runs/${encodeURIComponent(runId)}/events${q}`, { stream: true });
      yield* parseSse(res.body);
    },
    // Cross-run cost/quality rollup for the observation deck.
    async metrics({ target, from, to } = {}) {
      const q = new URLSearchParams();
      if (target) q.set("target", target);
      if (from) q.set("from", from);
      if (to) q.set("to", to);
      const suffix = q.toString() ? `?${q}` : "";
      return request("GET", `/metrics${suffix}`);
    },
  };
}

// Minimal SSE frame parser over a web ReadableStream (Node 20 fetch body). Yields
// { event, data } where data is JSON-parsed when possible. Exported for testing.
export async function* parseSse(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseFrame(frame);
        if (evt) yield evt;
      }
    }
  } finally {
    reader.releaseLock?.();
  }
}

function parseFrame(frame) {
  let event = "message";
  const dataLines = [];
  for (const line of frame.split("\n")) {
    if (line.startsWith(":")) continue; // comment/keepalive
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
  }
  if (dataLines.length === 0) return null;
  const raw = dataLines.join("\n");
  let data = raw;
  try {
    data = JSON.parse(raw);
  } catch {
    /* leave as string */
  }
  return { event, data };
}
