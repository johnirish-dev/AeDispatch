// Small helpers so pages do not repeat themselves.
// Security rule: data from the API is only ever inserted as text (textContent or
// text nodes). Nothing here builds HTML from a string.

import { strings } from "./strings.js";

const SVG_NS = "http://www.w3.org/2000/svg";

function append(parent, child) {
  if (child === null || child === undefined || child === false || child === true) return;
  if (Array.isArray(child)) {
    child.forEach((c) => append(parent, c));
  } else if (child instanceof Node) {
    parent.appendChild(child);
  } else {
    parent.appendChild(document.createTextNode(String(child)));
  }
}

/** h("button", { class: "btn", onclick: fn, "aria-label": "Close" }, "Text", otherNode) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === "class") el.className = value;
    else if (key === "dataset") Object.assign(el.dataset, value);
    else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value);
    else if (key === "value") el.value = value;
    else if (key in el && typeof el[key] === "boolean") el[key] = Boolean(value);
    else el.setAttribute(key, value === true ? "" : String(value));
  }
  children.forEach((c) => append(el, c));
  return el;
}

/** Same as h() for SVG elements. */
export function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value === null || value === undefined || value === false) continue;
    el.setAttribute(key, String(value));
  }
  children.forEach((c) => append(el, c));
  return el;
}

export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) => [...root.querySelectorAll(selector)];

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Two hidden live regions: screen readers hear success messages politely and
// errors right away.
function liveRegion(assertive) {
  const id = assertive ? "live-assertive" : "live-polite";
  let region = document.getElementById(id);
  if (!region) {
    region = h("div", { id, class: "sr-only", "aria-live": assertive ? "assertive" : "polite", "aria-atomic": "true" });
    document.body.appendChild(region);
  }
  return region;
}

export function announce(message, { assertive = false } = {}) {
  const region = liveRegion(assertive);
  region.textContent = "";
  // Changing the text a moment later makes the same message announce twice in a row.
  window.setTimeout(() => {
    region.textContent = message;
  }, 50);
}

/**
 * Replaces the content of `container` with a loading, empty or error message.
 * "ready" only removes such a message; the page then draws its own content.
 */
export function showState(container, state, { message = "", onRetry = null } = {}) {
  if (state === "ready") {
    const old = container.querySelector(":scope > [data-state]");
    if (old) old.remove();
    return;
  }
  clear(container);
  if (state === "loading") {
    container.appendChild(h("p", { class: "empty", role: "status", dataset: { state } }, message));
  } else if (state === "empty") {
    container.appendChild(h("p", { class: "empty", dataset: { state } }, message));
  } else if (state === "error") {
    container.appendChild(
      h(
        "div",
        { class: "empty", role: "alert", dataset: { state } },
        h("p", {}, message),
        onRetry ? h("button", { class: "btn btn--sm", type: "button", onclick: onRetry }, strings.common.retry) : null,
      ),
    );
  }
}
