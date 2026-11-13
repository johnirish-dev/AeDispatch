// A small dropdown menu with one choice selected (sort order, a filter). It replaces the
// browser's plain <select>, so it can carry icons, colour dots and counts.
//
// Keyboard: Enter/Space/ArrowDown opens it, the arrow keys move, Enter picks, Escape
// closes and returns to the button, Tab leaves. Items are role="menuitemradio", and the
// chosen one has aria-checked="true" (a check mark is drawn too, never colour alone).

import { h } from "./dom.js";
import { icon } from "./icons.js";

let menuCount = 0;
const openMenus = new Set();

// One listener closes every open menu when the person clicks somewhere else.
document.addEventListener("pointerdown", (event) => {
  openMenus.forEach((menu) => {
    if (!menu.root.contains(event.target)) menu.close();
  });
});

/**
 * items: [{ value, label, icon?, dot?, count? }]
 * Returns { root, setValue, setItems, setCounts }.
 */
export function menu({ label, iconName, items, value, onChange, title = label, align = "left", clearLabel = null, clearValue = null }) {
  const id = `menu-${++menuCount}`;
  const state = { items, value };
  const api = { root: null, close, setValue, setItems };

  const caret = icon("caretDown");
  caret.classList.add("menu__caret");
  const valueEl = h("span", { class: "menu__value" });
  const badge = h("span", { class: "menu__badge", hidden: true });
  const button = h(
    "button",
    {
      class: "menu__btn",
      type: "button",
      id: `${id}-button`,
      "aria-haspopup": "menu",
      "aria-expanded": "false",
      "aria-controls": `${id}-panel`,
      onclick: () => (panel.hidden ? open() : close()),
      onkeydown: (event) => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          open();
        }
      },
    },
    iconName ? icon(iconName) : null,
    h("span", { class: "menu__label" }, label),
    valueEl,
    badge,
    caret,
  );
  const list = h("div", { class: "menu__list", role: "none" });
  const panel = h(
    "div",
    {
      class: `menu__panel menu__panel--${align}`,
      id: `${id}-panel`,
      role: "menu",
      "aria-labelledby": `${id}-button`,
      hidden: true,
      onkeydown: onPanelKey,
    },
    h("p", { class: "menu__title" }, title),
    list,
  );
  const clear = clearLabel
    ? h("button", { class: "menu__clear", type: "button", role: "menuitem", onclick: () => choose(clearValue) }, clearLabel)
    : null;
  if (clear) panel.append(clear);
  const root = h("div", { class: "menu" }, button, panel);
  api.root = root;

  function itemButtons() {
    return [...panel.querySelectorAll('[role="menuitemradio"], .menu__clear')];
  }

  function draw() {
    list.replaceChildren(
      ...state.items.map((item) =>
        h(
          "button",
          {
            class: "menu__item",
            type: "button",
            role: "menuitemradio",
            "aria-checked": String(item.value === state.value),
            tabindex: "-1",
            onclick: () => choose(item.value),
          },
          item.dot ? h("span", { class: `menu__dot menu__dot--${item.dot}`, "aria-hidden": "true" }) : item.icon ? icon(item.icon) : null,
          h("span", { class: "menu__text" }, item.label),
          item.count === undefined ? null : h("span", { class: "menu__count" }, String(item.count)),
          h("span", { class: "menu__check" }, icon("check")),
        ),
      ),
    );
    const current = state.items.find((item) => item.value === state.value);
    // A menu that filters shows what is active as a badge; a sort menu shows the chosen order.
    if (clearLabel) {
      const active = state.value !== clearValue && current;
      badge.hidden = !active;
      badge.textContent = active ? current.label : "";
      valueEl.hidden = true;
      button.classList.toggle("menu__btn--active", Boolean(active));
      if (clear) clear.hidden = !active;
    } else {
      valueEl.textContent = current ? current.label : "";
    }
  }

  function choose(next) {
    state.value = next;
    draw();
    close();
    button.focus();
    onChange(next);
  }

  function open() {
    openMenus.forEach((m) => m !== api && m.close());
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    openMenus.add(api);
    (panel.querySelector('[aria-checked="true"]') ?? itemButtons()[0])?.focus();
  }

  function close() {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    openMenus.delete(api);
  }

  function onPanelKey(event) {
    const buttons = itemButtons().filter((b) => !b.hidden);
    const at = buttons.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      button.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      buttons[(at + 1) % buttons.length].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      buttons[(at - 1 + buttons.length) % buttons.length].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      buttons[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      buttons[buttons.length - 1].focus();
    } else if (event.key === "Tab") {
      close();
    }
  }

  function setValue(next) {
    state.value = next;
    draw();
  }
  function setItems(next) {
    state.items = next;
    draw();
  }

  draw();
  return api;
}
