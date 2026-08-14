// Client for the vault worker's internal write API. Vault writes go through the
// worker so they commit to the git source of truth (and the worker mirrors to S3 +
// re-grounds the KB synchronously before returning). Reads stay on the S3 mirror.

// actor: { id, name, email? } from the verified token(s). Git needs { name, email };
// prefer the verified email claim, else a name that looks like an email, else a
// stable synthetic address from the user id. The id rides along for S3 attribution.
function toGitAuthor(actor) {
  const name = actor?.name || actor?.id || "homebase";
  const email =
    actor?.email || (actor?.name && actor.name.includes("@") ? actor.name : `${actor?.id || "homebase"}@homebase.local`);
  return { name, email, id: actor?.id ?? null };
}

export function makeWorkerClient({ url, secret, fetchImpl = fetch }) {
  const base = url.replace(/\/$/, "");
  async function call(path, body) {
    const res = await fetchImpl(`${base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(secret ? { "x-worker-secret": secret } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`worker ${path} failed: ${res.status} ${text.slice(0, 200)}`);
      err.status = 502;
      err.code = "worker_error";
      throw err;
    }
    return res.json();
  }
  return {
    async write(key, content, actor) {
      return call("/write", { path: key, content, author: toGitAuthor(actor), message: `update ${key}` });
    },
    async remove(key, actor) {
      return call("/delete", { path: key, author: toGitAuthor(actor), message: `delete ${key}` });
    },
  };
}
