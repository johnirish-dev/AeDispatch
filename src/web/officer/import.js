// Case data import: the weekly case file that comes from the provincial office (PESO). The
// officer only receives it, so there is nothing to edit here. The officer picks the file, the
// server checks every row, and a file with no problem can be imported. A file with any problem is
// rejected as a whole and nothing is saved; the card then says what is wrong in a few plain lines
// so the sender can be asked for a corrected file. The checking is done by the server.

import { ApiError, get, post } from "../shared/api.js";
import { announce, clear, h, showState } from "../shared/dom.js";
import * as fmt from "../shared/format.js";
import { icon } from "../shared/icons.js";
import { mountShell } from "../shared/shell.js";
import { strings } from "../shared/strings.js";
import { problemGroups } from "./importHelp.js";

const t = strings.officer.import;
const MAX_BYTES = 1024 * 1024;
const MAX_PROBLEMS_SHOWN = 3;
const MAX_LATEST = 8;

const els = {};
/** The file that was loaded: { name, size, text, checking, failed, imported }, or null. */
let upload = null;
/** The last check: the text that was sent and the server's answer. */
let checked = null;
/** The barangays and their puroks, for the example file: [{ name, puroks: [] }]. */
let reference = [];
/** The imports so far (newest first) and the week the dashboard uses now, to warn about an outdated file. */
let imports = [];
let currentWeek = null;
/** The template file (the full text), for the example. */
let templateText = "";

// ---- banners ---------------------------------------------------------------------------

function showBanner(kind, text, link) {
  clear(els.banners);
  const banner = h(
    "div",
    { class: `banner banner--${kind}`, role: kind === "error" ? "alert" : "status", tabindex: "-1" },
    h("span", {}, text),
    link ? h("a", { href: link.href, class: "banner__link" }, link.label) : null,
  );
  els.banners.append(banner);
  announce(text, { assertive: kind === "error" });
  banner.focus();
}
const clearBanner = () => clear(els.banners);

// ---- the upload card: the invitation, then the file with its status ----------------------------

const sizeText = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** The few things that are wrong, in plain words: "barangay "Atlantis" is not in the system. · 2 rows". */
function problemList(lines) {
  const shown = lines.slice(0, MAX_PROBLEMS_SHOWN);
  const more = lines.length - shown.length;
  return h(
    "div",
    { class: "file__problems" },
    h("p", { class: "file__note" }, t.notImported),
    h(
      "ul",
      {},
      ...shown.map((line) => h("li", {}, line.message, line.rows ? h("span", { class: "muted" }, ` · ${t.fixRows(line.rows.length)}`) : null)),
      more > 0 ? h("li", { class: "muted" }, t.moreProblems(more)) : null,
    ),
  );
}

/** Whole weeks between two ISO weeks such as "2026-W45" (b minus a). */
function weeksBetween(a, b) {
  const monday = (label) => {
    const [, year, week] = /^(\d{4})-W(\d{2})$/.exec(label);
    const jan4 = new Date(Date.UTC(Number(year), 0, 4));
    const start = new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * 86400000);
    return start.getTime() + (Number(week) - 1) * 7 * 86400000;
  };
  return Math.round((monday(b) - monday(a)) / (7 * 86400000));
}

/** The scores only read the newest case week and the week before it, so an older file only adds to the trends. */
const isHistoryOnly = (result) => Boolean(result.isoWeek && currentWeek && weeksBetween(result.isoWeek, currentWeek) >= 2);

const totalPuroks = () => reference.reduce((sum, b) => sum + b.puroks.length, 0);

/** Reasons a file that is otherwise valid still cannot be imported. */
function blockersFor(result) {
  const list = [];
  if (result.isoWeek && currentWeek && result.isoWeek > currentWeek) list.push(t.blockFuture(result.isoWeek, currentWeek));
  const earlier = result.isoWeek ? imports.find((item) => item.isoWeek === result.isoWeek) : null;
  if (earlier) list.push(t.blockImported(result.isoWeek, fmt.date(earlier.importedAt)));
  const total = totalPuroks();
  if (total > 0 && result.rowCount < total) list.push(t.blockPartial(result.rowCount, total));
  return list;
}

/** Things worth a second look before importing a valid file. They warn; they never block. */
function warningsFor(result) {
  const list = [];
  const week = result.isoWeek;
  if (week && currentWeek && week < currentWeek) list.push(isHistoryOnly(result) ? t.warnHistory(week, currentWeek) : t.warnOld(week, currentWeek));
  return list;
}

function renderDrop() {
  clear(els.zoneBody);
  els.zone.classList.toggle("has-file", upload !== null);
  if (upload === null) {
    els.zoneBody.append(
      h("h2", { id: "drop-title" }, t.dropTitle),
      h("p", { class: "muted", id: "drop-note" }, t.dropNote),
      h("button", { class: "btn btn--primary", type: "button", "aria-describedby": "drop-note", onclick: () => els.file.click() }, t.upload),
    );
    return;
  }
  const result = checked !== null && checked.text === upload.text ? checked.result : null;
  const fileProblems = result ? result.rows.filter((r) => !r.ok).length + result.fileErrors.length : 0;
  const blockers = result && fileProblems === 0 && !upload.imported ? blockersFor(result) : [];
  const problems = fileProblems + blockers.length;
  let badge;
  let kind;
  if (upload.checking) [badge, kind] = [t.fileChecking, "checking"];
  else if (upload.failed || !result) [badge, kind] = [t.fileFailed, "bad"];
  else if (problems > 0) [badge, kind] = [t.fileRejected, "bad"];
  else if (upload.imported) [badge, kind] = [t.fileImported(result.isoWeek), "ok"];
  else [badge, kind] = [t.fileValid(result.isoWeek), "ok"];
  const valid = !upload.checking && result !== null && problems === 0;
  els.importBtn.disabled = !(valid && !upload.imported);
  els.importBtn.textContent = valid && isHistoryOnly(result) ? t.importHistory : t.importBtn;
  els.zoneBody.append(
    h(
      "div",
      { class: "file" },
      h("span", { class: "file__icon", "aria-hidden": "true" }, icon("file")),
      h(
        "div",
        { class: "file__text" },
        h("span", { class: "file__name", id: "drop-title" }, upload.name),
        h("span", { class: "file__meta" }, t.fileMeta(sizeText(upload.size), result ? result.rowCount : null)),
      ),
      h("span", { class: `file__status file__status--${kind}`, role: "status" }, kind === "ok" ? icon("check") : null, badge),
    ),
    ...(problems > 0 && result ? [problemList([...result.fileErrors.map((message) => ({ message, rows: null })), ...problemGroups(result.rows), ...blockers.map((message) => ({ message, rows: null }))])] : []),
    ...(valid && !upload.imported ? warningList(warningsFor(result)) : []),
    h(
      "div",
      { class: "file__actions" },
      valid ? els.importBtn : null,
      h("button", { class: "btn btn--sm", type: "button", onclick: () => els.file.click() }, t.replace),
      h("button", { class: "btn btn--sm btn--link", type: "button", onclick: removeUpload }, t.remove),
    ),
    els.after,
  );
}

function warningList(warnings) {
  if (warnings.length === 0) return [];
  return [h("ul", { class: "file__warnings", "aria-label": t.warnTitle }, ...warnings.map((w) => h("li", {}, w)))];
}

function removeUpload() {
  upload = null;
  checked = null;
  clear(els.after);
  clearBanner();
  renderDrop();
}

// ---- checking and importing --------------------------------------------------------------------

async function validate(file) {
  clearBanner();
  clear(els.after);
  try {
    const result = await post("/api/officer/cases/validate", { text: file.text });
    if (upload !== file) return; // another file was chosen meanwhile
    checked = { text: file.text, result };
    file.checking = false;
    const problems = result.rows.filter((r) => !r.ok).length + result.fileErrors.length;
    announce(t.summary(result.rowCount, problems));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (upload !== file) return;
    file.checking = false;
    file.failed = true;
    showBanner("error", err.message || strings.common.serverError);
  }
  renderDrop();
}

/** After an import: which barangays have Tier 2 evidence open now, from the server's own ranking. */
async function showAfterImport(result) {
  clear(els.after);
  try {
    const ranking = await get("/api/officer/ranking");
    const open = ranking.barangays.filter((b) => b.tier2.unlocked);
    els.after.append(h("h3", {}, t.afterTitle));
    if (result.isoWeek && ranking.summary.caseWeek && result.isoWeek > ranking.summary.caseWeek) {
      els.after.append(h("p", { class: "import__hint" }, t.afterFuture(result.isoWeek, ranking.summary.caseWeek)));
    }
    if (open.length === 0) {
      els.after.append(h("p", { class: "muted" }, t.afterNone));
      return;
    }
    els.after.append(
      h(
        "ul",
        { class: "import__after-list" },
        ...open.map((b) => h("li", {}, t.afterLine(b.name, b.tier2.puroks.map((p) => `${p.purok} (${p.cases})`).join(", ")))),
      ),
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    els.after.append(h("p", { class: "muted" }, t.afterError));
  }
}

async function importNow() {
  const file = upload;
  if (!file || checked === null || !checked.result.success || blockersFor(checked.result).length > 0) return;
  clearBanner();
  els.importBtn.disabled = true;
  const historyOnly = isHistoryOnly(checked.result);
  els.importBtn.textContent = t.importing;
  try {
    const result = await post("/api/officer/cases/import", { text: file.text });
    file.imported = true;
    renderDrop();
    if (historyOnly) {
      showBanner("success", t.importedHistory(result.rowCount, result.isoWeek), { href: "/officer/trends.html", label: t.importedHistoryLink });
      loadImports();
    } else {
      showBanner("success", t.imported(result.rowCount, result.isoWeek, result.affectedBarangayIds.length), { href: "/officer/", label: t.importedLink });
      loadImports();
      showAfterImport(result);
    }
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    if (err instanceof ApiError && err.status === 422 && err.body?.rows) {
      checked = { text: file.text, result: err.body };
      renderDrop();
      showBanner("error", t.notSaved);
    } else {
      showBanner("error", err.message || strings.common.serverError);
    }
  } finally {
    els.importBtn.textContent = historyOnly ? t.importHistory : t.importBtn;
  }
}

// ---- getting the file in: the button or a drop -------------------------------------------------

async function loadFile(file) {
  clearBanner();
  if (file.size > MAX_BYTES) {
    showBanner("error", t.tooLarge);
    return;
  }
  let text;
  try {
    text = await file.text();
  } catch {
    showBanner("error", t.readError);
    return;
  }
  checked = null;
  upload = { name: file.name, size: file.size, text, checking: true, failed: false, imported: false };
  renderDrop();
  validate(upload);
}

function buildDrop() {
  els.file = h("input", { type: "file", accept: ".csv,text/csv", class: "sr-only", tabindex: "-1", "aria-hidden": "true", onchange: () => {
    const file = els.file.files?.[0];
    els.file.value = "";
    if (file) loadFile(file);
  } });
  els.zoneBody = h("div", { class: "dropzone__body" });
  els.zone = h("section", { class: "dropzone", "aria-labelledby": "drop-title" }, els.zoneBody, els.file);
  const zone = els.zone;
  renderDrop();
  // Dropping a file works too (the button is the way for keyboard users).
  let depth = 0;
  zone.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    zone.classList.add("is-over");
  });
  zone.addEventListener("dragover", (e) => e.preventDefault());
  zone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) zone.classList.remove("is-over");
  });
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    zone.classList.remove("is-over");
    const file = e.dataTransfer?.files?.[0];
    if (file) loadFile(file);
  });
  return zone;
}

// ---- "what the file should look like" ----------------------------------------------------

function renderFormat() {
  clear(els.format);
  if (templateText === "") {
    els.format.append(h("p", { class: "muted" }, t.formatError));
    return;
  }
  // The header and the first three rows are enough to show the shape.
  els.format.append(h("pre", { class: "import__example", tabindex: "0", "aria-label": t.formatTitle }, templateText.split(/\r?\n/).slice(0, 4).join("\n")));
}

/** A ready-to-fill file: the header, then every purok of every barangay with 0 cases, for the given week. */
function buildTemplate(week) {
  const lines = ["week,barangay,purok,cases"];
  for (const b of reference) for (const purok of b.puroks) lines.push(`${week},${b.name},${purok},0`);
  return lines.join("\n") + "\n";
}

async function loadFormat() {
  const [barangays, ranking, template] = await Promise.allSettled([
    get("/api/officer/barangays"),
    get("/api/officer/ranking"),
    get("/api/officer/cases/samples/template"),
  ]);
  if (barangays.status === "fulfilled") reference = barangays.value.map((b) => ({ name: b.name, puroks: b.puroks.map((p) => p.name) }));
  const week = ranking.status === "fulfilled" ? ranking.value.summary.caseWeek : null;
  if (reference.length > 0 && week) templateText = buildTemplate(week);
  else if (template.status === "fulfilled") templateText = template.value.text; // fall back to the server's file
  else templateText = "";
  currentWeek = week;
  renderFormat();
  if (upload) renderDrop();
}

// ---- the right-hand cards ----------------------------------------------------------------

function renderImports(list) {
  clear(els.latest);
  if (list.length === 0) {
    els.latest.append(h("p", { class: "muted" }, t.latestNone));
    return;
  }
  els.latest.append(
    h(
      "ul",
      { class: "list" },
      ...list.slice(0, MAX_LATEST).map((item) =>
        h(
          "li",
          { class: "list__item" },
          h("div", { class: "list__text" }, h("span", { class: "list__title" }, item.isoWeek), h("span", { class: "list__sub" }, t.latestMeta(item.rowCount, fmt.dateTime(item.importedAt)))),
          h("span", { class: "badge" }, item.status),
        ),
      ),
    ),
  );
}

async function loadImports() {
  try {
    imports = await get("/api/officer/cases/imports");
    renderImports(imports);
    if (upload) renderDrop();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    showState(els.latest, "error", { message: err.message || t.latestError, onRetry: loadImports });
  }
}

// ---- the page ------------------------------------------------------------------------------

function build() {
  els.banners = h("div", { class: "decision-banners" });
  els.importBtn = h("button", { class: "btn btn--primary", type: "button", disabled: true, onclick: importNow }, t.importBtn);
  els.after = h("div", { class: "import__after" });
  els.latest = h("div", {}, h("span", { class: "skeleton", style: "width:70%" }));
  els.format = h("div", {}, h("span", { class: "skeleton", style: "width:60%" }));

  const formatCard = h("section", { class: "card", "aria-labelledby": "format-title" }, h("h2", { id: "format-title" }, t.formatTitle), h("p", { class: "card__sub" }, t.formatSub), h("div", { style: "margin-top: var(--s-4)" }, els.format));
  const rulesCard = h("section", { class: "card" }, h("h2", {}, t.rulesTitle), h("ol", { class: "import__rules" }, ...t.rules.map((rule) => h("li", {}, rule))));
  const latestCard = h("section", { class: "card" }, h("h2", {}, t.latestTitle), h("div", { style: "margin-top: var(--s-3)" }, els.latest));

  return [
    h("header", { class: "page-head" }, h("div", {}, h("h1", { class: "page-title" }, t.title), h("p", { class: "page-head__sub" }, t.sub))),
    els.banners,
    h("div", { class: "import" }, h("div", { class: "import__main" }, buildDrop(), h("div", { class: "import__row" }, formatCard, rulesCard)), latestCard),
  ];
}

document.getElementById("main").append(...build());
await mountShell({ active: "import" });
loadImports();
loadFormat();
