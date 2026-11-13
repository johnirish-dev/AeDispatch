// The officer layout: the sidebar (menu on top, who is signed in and Sign out at the
// bottom) and the page footer. Every officer page has an empty <aside id="shell-sidebar">
// and a <div class="content"> around its <main>; this fills them in. It also checks the
// session: on a 401 api.js sends the person to the login page.

import { get, post } from "./api.js";
import { h } from "./dom.js";
import { icon, sidebarIcon } from "./icons.js";
import { strings } from "./strings.js";

/** The logo and the name, as one link to the overview. Also used on the login page. */
export function brandLink({ href = "/officer/", disc = false } = {}) {
  const c = strings.common;
  return h(
    "a",
    { class: "brand", href, "aria-label": c.brand },
    h("span", { class: `brand__tile${disc ? " brand__tile--disc" : ""}` }, h("img", { src: disc ? "/shared/logo.svg" : "/shared/logo-panel.svg", alt: "" })),
    h("span", { class: "brand__name", "aria-hidden": "true" }, h("span", { class: "brand__ae" }, c.brandAe), c.brandRest),
  );
}

// Whether the sidebar is open is remembered in this browser. Storage can be blocked, so
// every read and write is guarded and the sidebar simply starts open without it.
const RAIL_KEY = "aedispatch.rail";
const readRail = () => {
  try {
    return window.localStorage.getItem(RAIL_KEY) === "collapsed" ? "collapsed" : "open";
  } catch {
    return "open";
  }
};
const writeRail = (value) => {
  try {
    window.localStorage.setItem(RAIL_KEY, value);
  } catch {
    /* not remembered; nothing else depends on it */
  }
};

const initials = (name) =>
  name
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "?";

async function signOut() {
  try {
    await post("/api/auth/logout");
  } finally {
    window.location.assign("/officer/login.html");
  }
}

export async function mountShell({ active }) {
  const t = strings.officer;
  const app = document.querySelector(".app");
  app.dataset.rail = readRail();

  // ---- the sidebar head: logo, and the button that opens and closes the sidebar ----
  const toggle = h("button", {
    class: "rail-toggle",
    type: "button",
    "aria-controls": "shell-sidebar",
    onclick: () => {
      app.dataset.rail = app.dataset.rail === "collapsed" ? "open" : "collapsed";
      writeRail(app.dataset.rail);
      syncToggle();
    },
  });
  function syncToggle() {
    const open = app.dataset.rail !== "collapsed";
    const label = open ? t.collapse : t.expand;
    toggle.replaceChildren(sidebarIcon(!open));
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", label);
    toggle.dataset.tip = label;
  }
  syncToggle();

  // Under 1100 px the sidebar is a top bar and has no room for the profile, so Sign out
  // sits in the head instead.
  const headSignOut = h("button", { class: "btn btn--sm head-signout", type: "button", onclick: signOut }, icon("signout"), strings.common.signOut);

  const link = (item) =>
    h("a", { href: item.href, title: item.label, "aria-current": item.key === active ? "page" : null }, icon(item.key), h("span", { class: "nav__label" }, item.label));
  const group = (title, items) => h("div", { class: "nav-group" }, h("p", { class: "nav-group__title" }, title), ...items.map(link));

  // ---- the foot: who is signed in, and Sign out below it ----
  const avatar = h("span", { class: "avatar", "aria-hidden": "true" }, "…");
  const name = h("strong", {}, " ");
  const foot = h(
    "div",
    { class: "sidebar__foot" },
    h("div", { class: "profile", title: t.office }, avatar, h("div", { class: "profile__who" }, name, h("span", {}, t.office))),
    h("button", { class: "signout", type: "button", title: strings.common.signOut, onclick: signOut }, icon("signout"), h("span", { class: "nav__label" }, strings.common.signOut)),
  );

  document.getElementById("shell-sidebar").append(
    h("div", { class: "sidebar__head" }, brandLink(), toggle, headSignOut),
    h(
      "nav",
      { class: "nav", "aria-label": t.navLabel },
      group(t.menuTitle, t.nav.filter((i) => i.group === "menu")),
      group(t.generalTitle, t.nav.filter((i) => i.group === "general")),
    ),
    foot,
  );

  document.querySelector(".content").append(h("footer", { class: "page-foot" }, strings.common.sampleData));

  // 401 here redirects to the login page (see api.js).
  const me = await get("/api/auth/me");
  avatar.textContent = initials(me.user.displayName);
  name.textContent = me.user.displayName;
}
