// Small fetch wrapper for the backend. The API token is typed in once on the
// login screen and kept in this browser's localStorage - same shared token
// the Android app uses (see docs/ARCHITECTURE.md, "Auth & hosting").
const TOKEN_KEY = "swgoh-overlay-token";

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private mode etc. - the session just won't be remembered.
  }
}

export class ApiError extends Error {
  constructor(status, body) {
    super((body && (body.error || body.message)) || `Request failed (${status})`);
    this.status = status;
    this.body = body || {};
  }
}

let unauthorizedHandler = () => {};
export function onUnauthorized(fn) {
  unauthorizedHandler = fn;
}

// api("/units") / api("/counters", { method: "POST", body: {...} }) /
// api("/units/3/image", { method: "POST", form: formData })
export async function api(path, { method = "GET", body, form, token } = {}) {
  const headers = { Authorization: `Bearer ${token ?? getToken()}` };
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, { error: "Can't reach the server - check your connection." });
  }

  if (res.status === 401) {
    if (token === undefined) unauthorizedHandler();
    throw new ApiError(401, { error: "That token was rejected." });
  }
  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}

export function imageUrl(imagePath) {
  return imagePath ? `/uploads/${encodeURIComponent(imagePath)}` : null;
}
