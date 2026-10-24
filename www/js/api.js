// The one door to the program: every call goes through window.ray.request as {op, …} and
// comes back as {ok, value} or {ok: false, error}. Nothing else in the page talks to it.

export class ApiError extends Error {
  constructor(message, reply) {
    super(message);
    this.cancelled = Boolean(reply && reply.cancelled);
  }
}

export function available() {
  return Boolean(window.ray && window.ray.request);
}

export async function call(op, args = {}) {
  if (!available()) throw new ApiError("not running inside RayReq");
  const raw = await window.ray.request(JSON.stringify({ op, ...args }));
  const reply = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!reply || !reply.ok) throw new ApiError((reply && reply.error) || "no reply", reply);
  return reply.value;
}

/// The page's errors, to the program's stderr.
export function log(message) {
  if (available()) call("log", { message: String(message) }).catch(() => {});
}
