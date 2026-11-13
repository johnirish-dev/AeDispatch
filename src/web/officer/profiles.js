// Barangay profiles: the barangays of the pilot area, with their population, area and puroks.
// The officer can add, edit and delete them. The server checks every value and re-scores after a
// change (population and area set the density that every score uses); this page only collects
// the values, shows the server's answer and asks before anything is deleted.

import { ApiError, get, post, put, del } from "../shared/api.js";
import { announce, clear, h, showState } from "../shared/dom.js";
import { icon } from "../shared/icons.js";
import { mountShell } from "../shared/shell.js";
import { strings } from "../shared/strings.js";

const t = strings.officer.profiles;

/** list: the barangays from the server. editing: null, { id: null } for a new one, or { id }. */
const state = { list: null, query: "", editing: null, puroks: [] };
const els = {};

// Lowercase and without accents, so "banag" finds "Bañag".
const plain = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const number = (n) => Number(n).toLocaleString("en-PH");

// ---- banners ---------------------------------------------------------------------------

function showBanner(kind, text) {
  clear(els.banners);
  const banner = h("div", { class: `banner banner--${kind}`, role: kind === "error" ? "alert" : "status", tabindex: "-1" }, h("span", {}, text));
  els.banners.append(banner);
  announce(text, { assertive: kind === "error" });
  banner.focus();
}
const clearBanner = () => clear(els.banners);

// ---- the list ---------------------------------------------------------------------------

/** "Purok 1 – Purok 6" when the names run in order, otherwise the number of puroks. */
function purokSummary(puroks) {
  const names = puroks.map((p) => p.name);
  const numbers = names.map((n) => /^Purok (\d+)$/.exec(n)?.[1]).map(Number);
  const ordered = names.length > 0 && numbers.every((n, i) => Number.isInteger(n) && (i === 0 || n === numbers[i - 1] + 1));
  if (ordered) return names.length === 1 ? names[0] : `${names[0]} – ${names[names.length - 1]}`;
  return t.purokCount(names.length);
}

function row(b) {
  const editing = state.editing?.id === b.id;
  return h(
    "tr",
    { class: editing ? "is-editing" : null },
    h("th", { scope: "row", class: "c-name" }, b.name),
    h("td", { class: "num c-pop", "data-label": t.columns.population }, number(b.population)),
    h("td", { class: "num c-area", "data-label": t.columns.area }, String(b.areaKm2)),
    h("td", { class: "c-puroks", "data-label": t.columns.puroks }, purokSummary(b.puroks)),
    h(
      "td",
      { class: "c-actions" },
      h("button", { class: "btn btn--sm", type: "button", "aria-label": t.editLabel(b.name), onclick: () => startEdit(b) }, t.edit),
      h("button", { class: "btn btn--sm btn--danger", type: "button", "aria-label": t.deleteLabel(b.name), onclick: () => askDelete(b) }, t.delete),
    ),
  );
}

function renderRows() {
  clear(els.tbody);
  const needle = plain(state.query.trim());
  const matches = state.list.filter((b) => plain(b.name).includes(needle));
  if (state.list.length === 0) {
    els.tbody.append(h("tr", {}, h("td", { colspan: 5, class: "empty" }, t.none)));
    return;
  }
  if (matches.length === 0) {
    els.tbody.append(
      h(
        "tr",
        {},
        h(
          "td",
          { colspan: 5, class: "empty" },
          t.noMatch,
          " ",
          h("button", { class: "btn btn--link", type: "button", onclick: () => { state.query = ""; els.search.value = ""; renderRows(); } }, t.clearSearch),
        ),
      ),
    );
    return;
  }
  matches.forEach((b) => els.tbody.append(row(b)));
}

async function load() {
  try {
    state.list = await get("/api/officer/barangays");
    showState(els.listState, "ready");
    renderRows();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    clear(els.tbody);
    showState(els.listState, "error", { message: err.message || t.loadError, onRetry: load });
  }
}

// ---- the panel: add or edit one barangay ----------------------------------------------------

/** A label, an input and a place for the message that belongs to it. */
function field(label, input, help = null) {
  const error = h("p", { class: "field__error", id: `${input.id}-error`, role: "alert" });
  const wrap = h("div", { class: "field" }, h("label", { class: "field__label", for: input.id }, label), input, help ? h("p", { class: "field__help" }, help) : null, error);
  return {
    el: wrap,
    setError(message) {
      wrap.classList.toggle("has-error", Boolean(message));
      error.textContent = message ?? "";
      input.setAttribute("aria-invalid", message ? "true" : "false");
      if (message) input.setAttribute("aria-describedby", error.id);
      else input.removeAttribute("aria-describedby");
    },
  };
}

function nextPurokName() {
  const used = state.puroks.map((n) => Number(/^Purok (\d+)$/.exec(n)?.[1] ?? 0));
  return `Purok ${Math.max(0, ...used) + 1}`;
}

function renderChips() {
  clear(els.chips);
  state.puroks.forEach((name) => {
    els.chips.append(
      h(
        "span",
        { class: "pchip" },
        name,
        h("button", { class: "pchip__x", type: "button", "aria-label": t.removePurok(name), onclick: () => {
          state.puroks = state.puroks.filter((n) => n !== name);
          renderChips();
          announce(t.purokRemoved(name));
        } }, icon("close")),
      ),
    );
  });
  if (els.purokAdding) {
    els.chips.append(els.purokForm);
  } else {
    els.chips.append(h("button", { class: "pchip pchip--add", type: "button", onclick: startAddPurok }, `+ ${t.addPurok}`));
  }
}

function startAddPurok() {
  els.purokAdding = true;
  els.purokInput.value = nextPurokName();
  renderChips();
  els.purokInput.focus();
  els.purokInput.select();
}

function commitPurok() {
  const name = els.purokInput.value.trim().replace(/\s+/g, " ");
  if (name === "") return;
  if (name.length > 40) return setPurokError(t.errors.purokLong);
  if (state.puroks.some((n) => n.toLowerCase() === name.toLowerCase())) return setPurokError(t.errors.purokDuplicate(name));
  state.puroks = [...state.puroks, name];
  els.purokAdding = false;
  setPurokError(null);
  renderChips();
  els.chips.querySelector(".pchip--add")?.focus();
  announce(t.purokAdded(name));
}

function cancelPurok() {
  els.purokAdding = false;
  setPurokError(null);
  renderChips();
  els.chips.querySelector(".pchip--add")?.focus();
}

function setPurokError(message) {
  els.purokError.textContent = message ?? "";
  els.purokError.hidden = !message;
}

/** What the form holds, checked with the same limits the server uses. */
function readForm() {
  const errors = {};
  const name = els.name.value.trim().replace(/\s+/g, " ");
  if (name === "") errors.name = t.errors.name;
  else if (name.length > 80) errors.name = t.errors.nameLong;
  const popText = els.population.value.replace(/[,\s]/g, "");
  const population = /^\d+$/.test(popText) ? Number(popText) : NaN;
  if (!(population >= 1 && population <= 5_000_000)) errors.population = t.errors.population;
  const areaText = els.area.value.trim();
  const area = areaText === "" ? NaN : Number(areaText);
  if (!(area > 0 && area <= 100_000)) errors.area = t.errors.area;
  if (state.puroks.length === 0) errors.puroks = t.errors.puroks;
  return { values: { name, population, areaKm2: area, puroks: state.puroks }, errors };
}

function showErrors(errors) {
  els.fName.setError(errors.name);
  els.fPopulation.setError(errors.population);
  els.fArea.setError(errors.area);
  els.puroksError.textContent = errors.puroks ?? "";
  els.puroksError.hidden = !errors.puroks;
  const first = ["name", "population", "area"].find((k) => errors[k]);
  if (first) els[first].focus();
  else if (errors.puroks) els.chips.querySelector("button")?.focus();
}

function openPanel(title, values, id) {
  state.editing = { id };
  state.puroks = values.puroks;
  els.panelTitle.textContent = title;
  els.name.value = values.name;
  els.population.value = values.population;
  els.area.value = values.area;
  els.purokAdding = false;
  setPurokError(null);
  showErrors({});
  els.formError.hidden = true;
  els.empty.hidden = true;
  els.form.hidden = false;
  els.panel.classList.add("is-open");
  renderChips();
  if (state.list) renderRows();
  els.panel.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  els.name.focus();
}

function startEdit(b) {
  clearBanner();
  openPanel(t.editTitle, { name: b.name, population: b.population, area: b.areaKm2, puroks: b.puroks.map((p) => p.name) }, b.id);
}

function startAdd() {
  clearBanner();
  openPanel(t.addTitle, { name: "", population: "", area: "", puroks: ["Purok 1"] }, null);
}

function closePanel() {
  state.editing = null;
  els.form.hidden = true;
  els.empty.hidden = false;
  els.panel.classList.remove("is-open");
  if (state.list) renderRows();
}

async function save(event) {
  event.preventDefault();
  if (els.purokAdding) commitPurok();
  clearBanner();
  const { values, errors } = readForm();
  showErrors(errors);
  if (Object.keys(errors).length > 0) return;

  const isNew = state.editing.id === null;
  els.saveBtn.disabled = true;
  els.saveBtn.textContent = t.saving;
  els.formError.hidden = true;
  try {
    if (isNew) await post("/api/officer/barangays", values);
    else await put(`/api/officer/barangays/${state.editing.id}`, values);
    closePanel();
    await load();
    showBanner("success", isNew ? t.added(values.name) : t.saved(values.name));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (err instanceof ApiError && err.status === 409) {
      els.fName.setError(err.message);
      els.name.focus();
    } else {
      els.formError.textContent = err.message || strings.common.serverError;
      els.formError.hidden = false;
      els.formError.focus();
    }
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = t.save;
  }
}

// ---- delete: always asks first -----------------------------------------------------------------

let pendingDelete = null;

function askDelete(b) {
  pendingDelete = b;
  els.confirmTitle.textContent = t.deleteTitle(b.name);
  els.confirmBody.textContent = t.deleteBody;
  els.confirmError.hidden = true;
  els.confirm.showModal();
}

async function confirmDelete() {
  const b = pendingDelete;
  if (!b) return;
  els.confirmBtn.disabled = true;
  els.confirmBtn.textContent = t.deleting;
  try {
    await del(`/api/officer/barangays/${b.id}`);
    els.confirm.close();
    if (state.editing?.id === b.id) closePanel();
    await load();
    showBanner("success", t.deleted(b.name));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    els.confirmError.textContent = err.message || strings.common.serverError;
    els.confirmError.hidden = false;
  } finally {
    els.confirmBtn.disabled = false;
    els.confirmBtn.textContent = t.deleteConfirm;
  }
}

// ---- the page ------------------------------------------------------------------------------

function buildList() {
  els.search = h("input", {
    class: "input search__input",
    type: "search",
    placeholder: t.search,
    "aria-label": t.searchLabel,
    autocomplete: "off",
    oninput: () => {
      state.query = els.search.value;
      if (state.list) renderRows();
    },
  });
  els.tbody = h("tbody", {}, h("tr", { "aria-hidden": "true" }, h("td", { colspan: 5 }, h("span", { class: "skeleton", style: "width:70%" }))));
  els.listState = h("div");
  return h(
    "section",
    { class: "card", "aria-label": t.title },
    h("div", { class: "toolbar" }, h("div", { class: "search" }, icon("search"), els.search)),
    els.listState,
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "table table--profiles" },
        h("caption", { class: "sr-only" }, t.caption),
        h("thead", {}, h("tr", {}, ...["barangay", "population", "area", "puroks"].map((k) => h("th", { scope: "col", class: k === "population" || k === "area" ? "num" : null }, t.columns[k])), h("th", { scope: "col" }, h("span", { class: "sr-only" }, t.columns.actions)))),
        els.tbody,
      ),
    ),
  );
}

function buildPanel() {
  els.panelTitle = h("h2", { id: "panel-title" }, t.editTitle);
  els.name = h("input", { class: "input", id: "p-name", type: "text", maxlength: "80", autocomplete: "off" });
  els.population = h("input", { class: "input", id: "p-population", type: "text", inputmode: "numeric", autocomplete: "off" });
  els.area = h("input", { class: "input", id: "p-area", type: "text", inputmode: "decimal", autocomplete: "off" });
  els.fName = field(t.fields.name, els.name);
  els.fPopulation = field(t.fields.population, els.population);
  els.fArea = field(t.fields.area, els.area);

  els.chips = h("div", { class: "pchips", id: "p-puroks" });
  els.purokError = h("p", { class: "field__error", role: "alert", hidden: true });
  els.purokError.style.display = "block";
  els.purokInput = h("input", {
    class: "input pchip__input",
    type: "text",
    maxlength: "40",
    "aria-label": t.purokName,
    autocomplete: "off",
    onkeydown: (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitPurok();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancelPurok();
      }
    },
  });
  els.purokForm = h(
    "span",
    { class: "pchip-form" },
    els.purokInput,
    h("button", { class: "btn btn--sm btn--primary", type: "button", onclick: commitPurok }, t.purokAdd),
    h("button", { class: "btn btn--sm", type: "button", onclick: cancelPurok }, t.cancel),
  );
  els.puroksError = h("p", { class: "field__error", role: "alert", hidden: true });
  els.puroksError.style.display = "block";

  els.formError = h("div", { class: "banner banner--error", role: "alert", tabindex: "-1", hidden: true });
  els.saveBtn = h("button", { class: "btn btn--primary", type: "submit" }, t.save);
  els.form = h(
    "form",
    { novalidate: "novalidate", hidden: true, onsubmit: save, "aria-labelledby": "panel-title" },
    els.panelTitle,
    h("div", { class: "stack", style: "margin-top: var(--s-4)" },
      els.fName.el,
      h("div", { class: "form-row" }, els.fPopulation.el, els.fArea.el),
      h("div", { class: "field" },
        h("span", { class: "field__label", id: "p-puroks-label" }, t.fields.puroks),
        els.chips,
        els.purokError,
        els.puroksError,
        h("p", { class: "field__help" }, t.purokNote),
      ),
      els.formError,
      h("div", { class: "import__actions" }, els.saveBtn, h("button", { class: "btn", type: "button", onclick: closePanel }, t.cancel)),
    ),
  );
  els.empty = h("div", {}, h("h2", {}, t.emptyTitle), h("p", { class: "muted", style: "margin-top: var(--s-2)" }, t.emptyBody));
  els.panel = h("aside", { class: "card profile-panel", "aria-label": t.panelLabel }, els.empty, els.form);
  return els.panel;
}

function buildConfirm() {
  els.confirmTitle = h("h2", { id: "confirm-title" });
  els.confirmBody = h("p", { class: "muted" });
  els.confirmError = h("p", { class: "field__error", role: "alert", hidden: true });
  els.confirmError.style.display = "block";
  els.confirmBtn = h("button", { class: "btn btn--danger", type: "button", onclick: confirmDelete }, t.deleteConfirm);
  els.confirm = h(
    "dialog",
    { class: "card confirm", "aria-labelledby": "confirm-title" },
    els.confirmTitle,
    els.confirmBody,
    els.confirmError,
    h("div", { class: "import__actions" }, h("button", { class: "btn btn--primary", type: "button", autofocus: "autofocus", onclick: () => els.confirm.close() }, t.cancel), els.confirmBtn),
  );
  return els.confirm;
}

els.banners = h("div", { class: "decision-banners" });
document.getElementById("main").append(
  h(
    "header",
    { class: "page-head" },
    h("div", {}, h("h1", { class: "page-title" }, t.title), h("p", { class: "page-head__sub" }, t.sub)),
    h("button", { class: "btn btn--primary", type: "button", onclick: startAdd }, icon("plus"), t.add),
  ),
  els.banners,
  h("div", { class: "profiles" }, buildList(), buildPanel()),
  buildConfirm(),
);
await mountShell({ active: "profiles" });
load();
