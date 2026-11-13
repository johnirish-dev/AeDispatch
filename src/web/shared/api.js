// One place for every request: JSON in and out, errors carry the server's text,
// and a 401 sends the person to the right sign-in page.
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

let signInPage = "/officer/login.html";
export function setSignInPage(url) {
  signInPage = url;
}

let bearer = null;
export function setBearerToken(token) {
  bearer = token;
}

export async function api(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Could not reach the server. Check your connection and try again.");
  }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 401 && signInPage) {
    window.location.assign(signInPage);
    throw new ApiError(401, data?.error ?? "Please sign in.", data);
  }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "Something went wrong. Please try again.", data);
  return data;
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, { method: "POST", body });
export const put = (path, body = {}) => api(path, { method: "PUT", body });
export const del = (path) => api(path, { method: "DELETE" });
