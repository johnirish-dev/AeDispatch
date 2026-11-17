// Demo tools (team only): the phone screens as QR codes, the weather simulator, the signal weights
// with a live preview, and the saved evaluation results. Everything shown here comes from
// /api/officer/demo/* and /api/officer/evaluation; the page itself calculates nothing about the ranking.

import { ApiError, get, post } from "../shared/api.js";
import { clear, h, showState } from "../shared/dom.js";
import * as fmt from "../shared/format.js";
import { mountShell } from "../shared/shell.js";
import { strings } from "../shared/strings.js";
import qrcode from "../shared/vendor/qrcode.js";

const t = strings.officer.demo;
const WEIGHT_KEYS = ["weather", "household", "symptom", "field", "cases"];

const mount = (key) => (els[key] = h("div", { class: "demo-body" }, h("span", { class: "skeleton chart-skeleton" })));
const els = {};
const section = (title, sub, body, extra = {}) =>
  h("section", { class: "card", ...extra }, h("h2", {}, title), h("p", { class: "card__sub" }, sub), body);

function fail(target, err, retry) {
  if (err instanceof ApiError && err.status === 401) return;
  showState(target, "error", { message: err.message || t.loadError, onRetry: retry });
}

function notice(target, text, kind = "success") {
  target.replaceChildren(h("p", { class: `banner banner--${kind}`, role: "status" }, text));
}

// ---------------------------------------------------------------- phone screens

function qrSvg(url, label) {
  const code = qrcode(0, "M");
  code.addData(url);
  code.make();
  const n = code.getModuleCount();
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${n + 8} ${n + 8}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", label);
  svg.setAttribute("class", "qr__svg");
  const bg = document.createElementNS(NS, "rect");
  bg.setAttribute("width", n + 8);
  bg.setAttribute("height", n + 8);
  bg.setAttribute("fill", "#fff");
  svg.appendChild(bg);
  let path = "";
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (code.isDark(r, c)) path += `M${c + 4} ${r + 4}h1v1h-1z`;
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", path);
  p.setAttribute("fill", "#000");
  svg.appendChild(p);
  return svg;
}

async function copy(url, status) {
  try {
    await navigator.clipboard.writeText(url);
    status.textContent = t.phones.copied;
  } catch {
    status.textContent = t.phones.copyFailed;
  }
}

function qrCard(name, sub, url) {
  const status = h("span", { class: "qr__status", role: "status" });
  return h(
    "article",
    { class: "qr" },
    h("div", { class: "qr__code" }, qrSvg(url, t.phones.qrLabel(name, url))),
    h("h3", { class: "qr__name" }, name),
    h("p", { class: "qr__sub" }, sub),
    h("a", { class: "qr__url", href: url, target: "_blank", rel: "noopener" }, url),
    h("div", { class: "row" }, h("button", { class: "btn btn--sm", type: "button", onclick: () => copy(url, status) }, t.phones.copy), status),
  );
}

async function loadPhones() {
  try {
    const links = await get("/api/officer/demo/links");
    // One BHW code for everyone: the BHW picks the barangay, the link follows it.
    const byBarangay = [...new Map(links.bhws.map((b) => [b.barangay, b])).values()].sort((a, b) => a.barangay.localeCompare(b.barangay));
    const bhwSlot = h("div", {});
    const showBhw = (barangay) => {
      const entry = byBarangay.find((b) => b.barangay === barangay);
      clear(bhwSlot);
      if (entry) bhwSlot.append(qrCard(t.phones.bhw, t.phones.bhwSub(entry.barangay), entry.url));
    };
    const select = h("select", { class: "select", id: "bhw-barangay", onchange: (e) => showBhw(e.target.value) }, ...byBarangay.map((b) => h("option", { value: b.barangay }, b.barangay)));
    if (byBarangay.length > 0) showBhw(byBarangay[0].barangay);
    clear(els.phones).append(
      ...(links.isLocalhost ? [h("div", { class: "banner banner--warn" }, h("strong", {}, t.phones.localhostTitle), h("p", {}, t.phones.localhostBody))] : []),
      h(
        "div",
        { class: "qr-grid" },
        qrCard(t.phones.resident, t.phones.residentSub, links.resident),
        h("div", { class: "qr-col" }, h("label", { class: "field" }, h("span", { class: "field__label" }, t.phones.pickBarangay), select), bhwSlot),
      ),
    );
  } catch (err) {
    fail(els.phones, err, loadPhones);
  }
}

// ---------------------------------------------------------------- weather

function drawWeather(state) {
  const w = t.weather;
  const buttons = state.presets.map((p) =>
    h("button", { class: "btn", type: "button", onclick: () => apply({ preset: p.key }, w.applied) }, p.label),
  );
  const temp = h("input", { class: "input", id: "wx-temp", type: "number", min: "10", max: "45", step: "0.5", value: "29" });
  const rain = h("input", { class: "input", id: "wx-rain", type: "number", min: "0", max: "1500", step: "1", value: "10" });
  const custom = () => {
    const tempC = Number(temp.value);
    const rainMm = Number(rain.value);
    if (temp.value === "" || rain.value === "" || tempC < 10 || tempC > 45 || rainMm < 0 || rainMm > 1500) return notice(els.weatherMsg, w.invalid, "error");
    apply({ tempC, rainMm }, w.applied);
  };
  const reset = h("button", { class: "btn btn--primary", type: "button", disabled: !state.simulated, onclick: () => run(post("/api/officer/demo/weather/reset"), w.resetDone) }, w.reset);

  const rows = state.days.map((d) =>
    h("tr", {}, h("th", { scope: "row" }, fmt.plainDate(d.date)), h("td", { class: "num" }, d.tempC.toFixed(1)), h("td", { class: "num" }, d.rainMm.toFixed(1)), h("td", {}, d.source === "simulated" ? h("span", { class: "badge badge--solid" }, t.simulatedBadge) : (w.sources[d.source] ?? d.source))),
  );
  clear(els.weather).append(
    h("p", { class: "weather__state" }, state.simulated ? h("span", { class: "badge badge--solid" }, t.simulatedBadge) : null, " ", state.simulated ? w.usingSimulated : w.usingStored),
    h("div", { class: "form-block" }, h("h3", {}, w.presetsLabel), h("div", { class: "row" }, ...buttons)),
    h(
      "div",
      { class: "form-block" },
      h("h3", {}, w.customLabel),
      h("div", { class: "form-row" }, h("label", { class: "field" }, h("span", { class: "field__label" }, w.temp), temp, h("span", { class: "field__help" }, w.tempHelp)), h("label", { class: "field" }, h("span", { class: "field__label" }, w.rain), rain, h("span", { class: "field__help" }, w.rainHelp))),
      h("div", { class: "row" }, h("button", { class: "btn", type: "button", onclick: custom }, w.apply), reset),
    ),
    h("div", { class: "weather__msg", ref: null }, ""),
    h("a", { class: "btn btn--link", href: "/officer/queue.html" }, w.seeQueue),
    h("h3", {}, w.daysTitle),
    h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("thead", {}, h("tr", {}, h("th", {}, w.date), h("th", { class: "num" }, w.tempCol), h("th", { class: "num" }, w.rainCol), h("th", {}, w.source))), h("tbody", {}, ...rows))),
  );
  els.weatherMsg = els.weather.querySelector(".weather__msg");
}

async function run(promise, okText) {
  try {
    drawWeather(await promise);
    notice(els.weatherMsg, okText);
  } catch (err) {
    notice(els.weatherMsg, err.message || t.loadError, "error");
  }
}
const apply = (body, okText) => run(post("/api/officer/demo/weather", body), okText);

async function loadWeather() {
  try {
    drawWeather(await get("/api/officer/demo/weather"));
  } catch (err) {
    fail(els.weather, err, loadWeather);
  }
}

// ---------------------------------------------------------------- weights

const pct = (x) => `${Math.round(x * 100)}%`;
let active = null;
let weights = null; // what the sliders hold, as fractions
let previewTimer = 0;
let previewSeq = 0;

function normalised(changedKey, value) {
  // The other four keep their proportions and share what is left, so the total is always 100%.
  const next = { ...weights, [changedKey]: Math.min(1, Math.max(0, value)) };
  const others = WEIGHT_KEYS.filter((k) => k !== changedKey);
  const rest = 1 - next[changedKey];
  const sum = others.reduce((a, k) => a + weights[k], 0);
  for (const k of others) next[k] = sum > 0 ? (weights[k] / sum) * rest : rest / others.length;
  return next;
}

function drawSliders() {
  clear(els.sliders).append(
    ...WEIGHT_KEYS.map((key) => {
      const out = h("output", { class: "weight__value", for: `w-${key}` }, pct(weights[key]));
      const input = h("input", {
        class: "weight__range",
        id: `w-${key}`,
        type: "range",
        min: "0",
        max: "100",
        step: "1",
        value: String(Math.round(weights[key] * 100)),
        oninput: (e) => {
          weights = normalised(key, Number(e.target.value) / 100);
          for (const k of WEIGHT_KEYS) {
            document.getElementById(`w-${k}`).value = String(Math.round(weights[k] * 100));
            document.getElementById(`w-${k}`).nextSibling.textContent = pct(weights[k]);
          }
          schedulePreview();
        },
      });
      return h("div", { class: "weight" }, h("label", { class: "weight__name", for: `w-${key}` }, t.weights.names[key]), input, out);
    }),
  );
}

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(loadPreview, 150);
}

async function loadPreview() {
  const mine = ++previewSeq;
  try {
    const { rows } = await post("/api/officer/demo/parameters/preview", { weights });
    if (mine !== previewSeq) return; // an older answer arriving late
    const w = t.weights;
    const changed = rows.some((r) => r.rankNew !== r.rankNow);
    const move = (r) => (r.rankNew === r.rankNow ? w.same : r.rankNew < r.rankNow ? h("span", { class: "move move--up" }, "▲ " + w.up(r.rankNow - r.rankNew)) : h("span", { class: "move move--down" }, "▼ " + w.down(r.rankNew - r.rankNow)));
    clear(els.preview).append(
      h("h3", {}, w.previewTitle),
      h("p", { class: "card__sub" }, changed ? w.previewSub : w.noChange),
      h(
        "div",
        { class: "table-wrap" },
        h(
          "table",
          { class: "table" },
          h("thead", {}, h("tr", {}, h("th", {}, w.place), h("th", {}, w.barangay), h("th", { class: "num" }, `${w.score} (${w.now})`), h("th", { class: "num" }, `${w.score} (${w.next})`), h("th", {}, w.change))),
          h("tbody", {}, ...rows.map((r) => h("tr", {}, h("td", {}, r.rankNew), h("th", { scope: "row" }, r.name), h("td", { class: "num" }, r.scoreNow.toFixed(3)), h("td", { class: "num" }, r.scoreNew.toFixed(3)), h("td", {}, move(r))))),
        ),
      ),
    );
  } catch (err) {
    fail(els.preview, err, loadPreview);
  }
}

function drawVersions(data) {
  const w = t.weights;
  const rows = [...data.versions].reverse().map((v) =>
    h(
      "tr",
      {},
      h("th", { scope: "row" }, `v${v.version}`),
      h("td", {}, v.note ?? "—"),
      h("td", {}, WEIGHT_KEYS.map((k) => `${w.names[k].split(" ")[0]} ${pct(v.weights[k])}`).join(" · ")),
      h("td", {}, v.isActive ? h("span", { class: "badge badge--solid" }, w.inUse) : h("button", { class: "btn btn--sm", type: "button", onclick: (e) => activate(v.version, e.currentTarget) }, w.activate)),
    ),
  );
  clear(els.versions).append(h("h3", {}, w.versionsTitle), h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("thead", {}, h("tr", {}, h("th", {}, w.version), h("th", {}, w.noteCol), h("th", {}, w.title), h("th", {}, ""))), h("tbody", {}, ...rows))));
}

async function activate(version, button) {
  button.disabled = true;
  button.textContent = t.weights.activating;
  try {
    await post(`/api/officer/demo/parameters/${version}/activate`);
    await loadWeights();
    notice(els.weightsMsg, t.weights.activated(version));
  } catch (err) {
    button.disabled = false;
    button.textContent = t.weights.activate;
    notice(els.weightsMsg, err.message || t.loadError, "error");
  }
}

async function save(button, note) {
  button.disabled = true;
  button.textContent = t.weights.saving;
  try {
    const saved = await post("/api/officer/demo/parameters", { weights, note: note.value });
    note.value = "";
    drawVersions(await get("/api/officer/demo/parameters"));
    notice(els.weightsMsg, t.weights.saved(saved.version));
  } catch (err) {
    notice(els.weightsMsg, err.message || t.loadError, "error");
  } finally {
    button.disabled = false;
    button.textContent = t.weights.save;
  }
}

async function loadWeights() {
  try {
    const data = await get("/api/officer/demo/parameters");
    active = data.active;
    weights = { ...active.weights };
    const note = h("input", { class: "input", id: "w-note", type: "text", maxlength: "200", placeholder: t.weights.notePlaceholder });
    const saveBtn = h("button", { class: "btn btn--primary", type: "button", onclick: () => save(saveBtn, note) }, t.weights.save);
    els.weightsMsg = h("div", {});
    clear(els.weights).append(
      h("p", { class: "weights__total" }, t.weights.total),
      (els.sliders = h("div", { class: "weights" })),
      h("div", { class: "row" }, h("button", { class: "btn btn--sm", type: "button", onclick: () => { weights = { ...active.weights }; drawSliders(); schedulePreview(); } }, t.weights.reset)),
      h("label", { class: "field" }, h("span", { class: "field__label" }, t.weights.note), note),
      h("div", { class: "row" }, saveBtn),
      els.weightsMsg,
      (els.preview = h("div", { class: "preview" })),
      (els.versions = h("div", { class: "versions" })),
    );
    drawSliders();
    drawVersions(data);
    loadPreview();
  } catch (err) {
    fail(els.weights, err, loadWeights);
  }
}

// ---------------------------------------------------------------- evaluation results

const mean = (x) => (typeof x === "number" ? x : x.mean);
const find = (rows, match) => rows.find((r) => Object.entries(match).every(([k, v]) => r[k] === v));
const num = (x) => Number(x).toFixed(3);

/** Horizontal bars. items: [{ label, value, note?, tone? }]; value 0..max. Negative values grow to the left of the middle line. */
function bars(items, { max, title, format = num, diverging = false }) {
  const top = max ?? Math.max(1e-9, ...items.map((i) => Math.abs(i.value)));
  return h(
    "ul",
    { class: `hbars${diverging ? " hbars--div" : ""}`, role: "list", "aria-label": title },
    ...items.map((i) => {
      const width = Math.min(100, (Math.abs(i.value) / top) * (diverging ? 50 : 100));
      const style = diverging ? (i.value >= 0 ? `left:50%;width:${width}%` : `left:${50 - width}%;width:${width}%`) : `width:${width}%`;
      return h("li", { class: "hbars__row" }, h("span", { class: "hbars__label" }, i.label), h("span", { class: "hbars__track" }, h("i", { class: `hbars__fill${i.tone ? ` hbars__fill--${i.tone}` : ""}`, style })), h("span", { class: "hbars__value" }, format(i.value), i.note ? h("small", {}, ` ${i.note}`) : null));
    }),
  );
}

function table(head, body) {
  return h("div", { class: "table-wrap" }, h("table", { class: "table" }, h("thead", {}, h("tr", {}, ...head.map((x) => h("th", {}, x)))), h("tbody", {}, ...body.map((r) => h("tr", {}, ...r.map((c, i) => (i === 0 ? h("th", { scope: "row" }, c) : h("td", {}, c))))))));
}

function resultCard(n, text, chart, details, extra = []) {
  return h(
    "article",
    { class: "result" },
    h("h3", { class: "result__title" }, text.title),
    h("p", { class: "result__message" }, text.message),
    chart,
    ...extra,
    h("details", { class: "result__details" }, h("summary", {}, t.results.showNumbers), details),
    h("p", { class: "result__how" }, h("strong", {}, `${t.results.howTo}: `), text.how),
    h("p", { class: "result__limit" }, h("strong", {}, `${t.results.limit}: `), text.limit),
  );
}

function qualityCard(ev) {
  const r = t.results;
  const m = (method, metric) => mean(find(ev.quality.rows, { method, k: 10, metric }).value);
  const methods = ["AeDispatch", "case-count-only", "weather-only", "random"];
  const items = methods.map((x) => ({ label: r.methods[x], value: m(x, "emergingNdcg"), tone: x === "AeDispatch" ? "brand" : "" }));
  const details = table([r.fairness.colMethod, r.quality.colNew, r.quality.colAll, r.quality.colRate], methods.map((x) => [r.methods[x], num(m(x, "emergingNdcg")), num(m(x, "ndcg")), num(m(x, "rateNdcg"))]));
  return resultCard(1, r.quality, bars(items, { max: 1, title: r.quality.chartTitle }), details);
}

function robustnessCard(ev) {
  const r = t.results;
  const rows = ev.robustness.rows.filter((x) => x.metric === "emergingNdcg" && x.method === "AeDispatch");
  const base = mean(find(ev.robustness.rows, { scenario: "clean", method: "case-count-only", metric: "emergingNdcg" }).value);
  const clean = mean(find(rows, { scenario: "clean" }).value);
  const pick = [["household", 0.8], ["symptoms", 0.8], ["field", 0.5], ["cases", 0.5], ["weather", 0.5], ["spam", 0.2]];
  const items = [{ label: r.robustness.clean, value: clean, tone: "brand" }, ...pick.map(([s, lv]) => {
    const row = find(rows, { scenario: s, level: lv });
    return row ? { label: s === "spam" ? r.robustness.spamLabel(Math.round(lv * 100)) : r.robustness.lost(r.robustness.scenarios[s], Math.round(lv * 100)), value: mean(row.value) } : null;
  }).filter(Boolean), { label: r.robustness.baseline, value: base, tone: "grey" }];
  const details = table([r.robustness.colScenario, r.robustness.colLevel, r.robustness.colScore], rows.map((x) => [x.label, x.level, num(mean(x.value))]));
  return resultCard(2, r.robustness, bars(items, { max: 0.5, title: r.robustness.chartTitle }), details);
}

function sensitivityCard(ev) {
  const r = t.results;
  const get2 = (variable, value, method) => mean(ev.sensitivity.rows.find((x) => x.variable === variable && x.value === value && x.method === method && x.metric === "emergingNdcg").interval);
  const items = [];
  for (const w of [4, 3, 2, 1, 0]) {
    items.push({ label: `${r.methods.AeDispatch} · ${r.sensitivity.weeks(w)}`, value: get2("leadWeeks", w, "AeDispatch"), tone: "brand" });
    items.push({ label: `${r.methods["case-count-only"]} · ${r.sensitivity.weeks(w)}`, value: get2("leadWeeks", w, "case-count-only"), tone: "grey" });
  }
  const details = table([r.sensitivity.colVariable, r.sensitivity.colValue, r.methods.AeDispatch, r.methods["case-count-only"]], ev.sensitivity.rows.filter((x) => x.method === "AeDispatch" && x.metric === "emergingNdcg").map((x) => [r.sensitivity.variables[x.variable] ?? x.variable, x.value, num(mean(x.interval)), num(mean(ev.sensitivity.rows.find((y) => y.variable === x.variable && y.value === x.value && y.method === "case-count-only" && y.metric === "emergingNdcg").interval))]));
  return resultCard(3, r.sensitivity, bars(items, { max: 0.5, title: r.sensitivity.chartTitle }), details);
}

function tiersCard(ev) {
  const r = t.results;
  const cap = (method, k) => mean(ev.tiers.capacity.find((x) => x.method === method && x.k === k).value);
  const methods = ["AeDispatch", "case-count-only", "weather-only", "random"];
  const items = [];
  for (const k of [5, 10, 20]) for (const x of methods) items.push({ label: `${k} ${r.tiers.teams.toLowerCase()} · ${r.methods[x]}`, value: cap(x, k), tone: x === "AeDispatch" ? "brand" : "grey", note: "" });
  const burden = (metric) => mean(ev.tiers.burden.find((x) => x.metric === metric).value);
  const t1 = (method, metric) => mean(ev.tiers.tier1.find((x) => x.method === method && x.metric === metric).value);
  const extra = [
    h("ul", { class: "result__facts" },
      h("li", {}, r.tiers.burden(Math.round(burden("flaggedPerWeek")), Math.round(burden("shareOfBarangaysFlagged") * 100))),
      h("li", {}, r.tiers.caught(Math.round(t1("AeDispatch", "coverageBeforeOnset") * 100), Math.round(t1("case-count-only", "coverageBeforeOnset") * 100))),
      h("li", {}, r.tiers.property(ev.tiers.tier2.property.checks, ev.tiers.tier2.property.violations)),
      h("li", {}, r.tiers.tier2Rate(Math.round(ev.tiers.tier2.shareOfBarangayWeeks.mean * 1000) / 10))),
  ];
  const details = table([r.tiers.teams, ...methods.map((x) => r.methods[x])], [1, 2, 3, 5, 10, 15, 20].map((k) => [k, ...methods.map((x) => pct(cap(x, k)))]));
  return resultCard(4, r.tiers, bars(items, { max: 0.3, title: r.tiers.chartTitle, format: pct }), details, extra);
}

function sourcesCard(ev) {
  const r = t.results;
  const adds = ev.ablation.adds.filter((x) => x.metric === "emergingNdcg");
  const items = adds.map((x) => ({ label: t.weights.names[x.source] ?? x.source, value: mean(x.adds), tone: x.verdict === "worse" ? "bad" : "brand" }));
  const details = table([r.sources.colSource, r.sources.colAdds, r.sources.colVerdict], adds.map((x) => [t.weights.names[x.source] ?? x.source, num(mean(x.adds)), r.sources.verdicts[x.verdict === "better" ? "better" : x.verdict === "worse" ? "worse" : "tie"]]));
  return resultCard(5, r.sources, bars(items, { max: 0.25, title: r.sources.chartTitle, diverging: true }), details);
}

function smoothingCard(ev) {
  const r = t.results;
  const scen = "some very small barangays";
  const vol = (s) => mean(ev.smoothing.rows.find((x) => x.scenario === scen && x.strength === s && x.metric === "rankVolatility").value);
  const items = ["none", "stored", "3x stored"].map((s) => ({ label: r.smoothing.strengths[s], value: vol(s), tone: s === "stored" ? "brand" : "grey" }));
  const details = table([r.smoothing.colScenario, r.smoothing.colStrength, r.smoothing.colVolatility], ev.smoothing.rows.filter((x) => x.metric === "rankVolatility").map((x) => [x.scenario, r.smoothing.strengths[x.strength] ?? x.strength, Number(mean(x.value)).toFixed(1)]));
  return resultCard(6, r.smoothing, bars(items, { title: r.smoothing.chartTitle, format: (v) => v.toFixed(1) }), details);
}

function fairnessCard(ev) {
  const r = t.results;
  const g = (scenario, grouping, group, method = "AeDispatch") => mean(ev.fairness.groups.find((x) => x.scenario === scenario && x.grouping === grouping && x.group === group && x.method === method && x.k === 10).caught);
  const items = [
    { label: r.fairness.usual, value: g("uneven reporting", "reporting", "reports as usual"), tone: "brand" },
    { label: r.fairness.little, value: g("uneven reporting", "reporting", "reports little"), tone: "bad" },
    { label: r.fairness.control, value: g("even reporting", "reporting", "reports little"), tone: "grey" },
    ...["small third", "middle third", "large third"].map((s) => ({ label: r.fairness.sizeGroups[s], value: g("even reporting", "size", s), tone: "brand" })),
  ];
  const details = table([r.fairness.colGroup, r.fairness.colMethod, r.fairness.colReached], ev.fairness.groups.filter((x) => x.k === 10 && x.method === "AeDispatch").map((x) => [`${x.scenario} · ${x.group}`, r.methods[x.method], pct(mean(x.caught))]));
  return resultCard(7, r.fairness, bars(items, { max: 0.3, title: r.fairness.chartTitle, format: pct }), details);
}

function performanceCard(ev) {
  const r = t.results;
  const time = (us) => (us >= 1000 ? `${(us / 1000).toFixed(us >= 100000 ? 0 : 1)} ms` : `${us.toFixed(1)} µs`);
  const rows = ev.performance.rows;
  const items = rows.flatMap((x) => [
    { label: `${x.n.toLocaleString()} · ${r.performance.heap}`, value: Math.log10(Math.max(1, x.heapRefresh.median * 10)), tone: "brand", display: time(x.heapRefresh.median) },
    { label: `${x.n.toLocaleString()} · ${r.performance.resort}`, value: Math.log10(Math.max(1, x.resortRefresh.median * 10)), tone: "grey", display: time(x.resortRefresh.median) },
  ]);
  const log = h("ul", { class: "hbars", role: "list", "aria-label": r.performance.chartTitle }, ...items.map((i) => h("li", { class: "hbars__row" }, h("span", { class: "hbars__label" }, i.label), h("span", { class: "hbars__track" }, h("i", { class: `hbars__fill hbars__fill--${i.tone}`, style: `width:${Math.min(100, (i.value / 6) * 100)}%` })), h("span", { class: "hbars__value" }, i.display))));
  const details = table([r.performance.colN, r.performance.colHeap, r.performance.colResort, r.performance.colFaster], rows.map((x) => [x.n.toLocaleString(), time(x.heapRefresh.median), time(x.resortRefresh.median), `${(x.resortRefresh.median / x.heapRefresh.median).toFixed(1)}×`]));
  const extra = [
    h("p", { class: "result__machine" }, r.performance.machine(ev.performance.machine)),
    h("p", { class: "result__machine" }, r.performance.slopes(ev.performance.slopes.heapRefresh.toFixed(2), ev.performance.slopes.resortRefresh.toFixed(2))),
    h("ul", { class: "result__facts" }, ...ev.performance.requirements.map((q) => h("li", {}, r.performance.requirement(q.name, q.measuredMs.toFixed(3), q.limitMs, q.passed) + ` · ${q.n.toLocaleString()}`))),
  ];
  return resultCard(8, r.performance, log, details, extra);
}

function drawResults(ev) {
  const r = t.results;
  const cards = [qualityCard, robustnessCard, sensitivityCard, tiersCard, sourcesCard, smoothingCard, fairnessCard, performanceCard].map((make) => {
    try {
      return make(ev);
    } catch {
      return h("article", { class: "result" }, h("p", { class: "banner banner--warn" }, r.loadError));
    }
  });
  clear(els.results).append(h("p", { class: "result__when" }, r.lastRun(fmt.dateTime(ev.generatedAt), ev.mode)), h("p", { class: "banner banner--warn" }, r.simulatedNote), h("div", { class: "results-grid" }, ...cards));
}

async function loadResults() {
  try {
    drawResults(await get("/api/officer/evaluation"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      clear(els.results).append(h("div", { class: "empty" }, h("p", {}, h("strong", {}, t.results.none)), h("p", {}, t.results.noneHow)));
    } else fail(els.results, err, loadResults);
  }
}

// ---------------------------------------------------------------- page

const panels = [
  ["phones", section(t.phones.title, t.phones.sub, mount("phones"))],
  ["weather", section(t.weather.title, t.weather.sub, mount("weather"))],
  ["weights", section(t.weights.title, t.weights.sub, mount("weights"))],
  ["results", section(t.results.title, t.results.sub, mount("results"))],
];
const tabButtons = new Map();
function showTab(key) {
  for (const [k, panel] of panels) {
    panel.hidden = k !== key;
    tabButtons.get(k).setAttribute("aria-selected", String(k === key));
    tabButtons.get(k).tabIndex = k === key ? 0 : -1;
  }
  try { sessionStorage.setItem("demoTab", key); } catch { /* the tab is only a convenience */ }
}
const tabBar = h("div", { class: "tabs", role: "tablist", "aria-label": t.tabsLabel });
panels.forEach(([key, panel], i) => {
  panel.id = `panel-${key}`;
  panel.setAttribute("role", "tabpanel");
  const button = h("button", { class: "tab", type: "button", role: "tab", id: `tab-${key}`, "aria-controls": panel.id, onclick: () => showTab(key), onkeydown: (e) => {
    const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!move) return;
    const next = panels[(i + move + panels.length) % panels.length][0];
    showTab(next);
    tabButtons.get(next).focus();
  } }, t.phones.tabs[key]);
  tabButtons.set(key, button);
  tabBar.append(button);
});

document.getElementById("main").append(
  h("header", { class: "page-head" }, h("div", {}, h("h1", { class: "page-title" }, t.title, " ", h("span", { class: "badge badge--dashed" }, t.teamOnly)), h("p", { class: "page-head__sub" }, t.sub))),
  tabBar,
  ...panels.map(([, panel]) => panel),
);
let first = "phones";
try { const saved = sessionStorage.getItem("demoTab"); if (saved && tabButtons.has(saved)) first = saved; } catch { /* no storage: start on Phones */ }
showTab(first);
await mountShell({ active: "demo" });
loadPhones();
loadWeather();
loadWeights();
loadResults();
