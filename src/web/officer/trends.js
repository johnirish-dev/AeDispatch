// Trends: week by week for the past eight weeks, the confirmed cases, how many barangays sit at each
// risk level, and one figure for each of the other data sources. The numbers come from /api/officer/trends.

import { ApiError, get } from "../shared/api.js";
import { lineChart } from "../shared/chart.js";
import { clear, h, showState } from "../shared/dom.js";
import * as fmt from "../shared/format.js";
import { mountShell } from "../shared/shell.js";
import { strings } from "../shared/strings.js";

const t = strings.officer.trends;
const els = {};

function card(title, key, note = null) {
  els[key] = h("div", {}, h("span", { class: "skeleton chart-skeleton" }));
  els[`${key}Caption`] = h("p", { class: "card__sub" }, note ?? " ");
  return h("section", { class: "card" }, h("h2", {}, title), els[`${key}Caption`], els[key]);
}

function draw(trends) {
  const partial = trends.latestWeekPartial === true;
  const labels = trends.weeks.map(fmt.weekShort);
  const last = labels.length - 1;
  const brand = "var(--brand)";

  els.casesCaption.textContent = t.casesCaption(trends.casesPerWeek[last], trends.casesPerWeek[last - 1], labels[last]);
  clear(els.cases).append(lineChart({ labels, partialLast: partial, title: t.casesChartTitle, desc: t.casesChartDesc, series: [{ name: t.casesSeries, color: brand, values: trends.casesPerWeek }] }));
  if (partial) els.casesCaption.textContent += ` ${t.partialNote}`;

  const count = (level) => trends.riskPerWeek.map((week) => week[level]);
  const atAction = (i) => trends.riskPerWeek[i].elevated + trends.riskPerWeek[i].high;
  els.riskCaption.textContent = t.riskCaption(atAction(last), atAction(last - 1));
  clear(els.risk).append(
    lineChart({
      labels,
      partialLast: partial,
      title: t.riskChartTitle,
      desc: t.riskChartDesc,
      series: [
        { name: fmt.riskLabel("high"), color: "var(--high-fill)", values: count("high") },
        { name: fmt.riskLabel("elevated"), color: "var(--elev-fill)", values: count("elevated") },
        { name: fmt.riskLabel("moderate"), color: "var(--mod-fill)", values: count("moderate") },
        { name: fmt.riskLabel("low"), color: "var(--low-fill)", values: count("low") },
      ],
    }),
  );

  if (partial) els.signalsCaption.textContent += ` ${t.partialNote}`;
  const sig = trends.signals;
  const names = t.signals;
  clear(els.signals).append(
    lineChart({
      labels,
      partialLast: partial,
      shared: false,
      title: t.signalsChartTitle,
      desc: t.signalsChartDesc,
      series: [
        { ...names.rain, color: brand, values: sig.rainMm },
        { ...names.temp, color: brand, values: sig.meanTempC, zeroBased: false },
        { ...names.reports, color: brand, values: sig.householdReports },
        { ...names.symptoms, color: brand, values: sig.symptomWarnings },
        { ...names.containers, color: brand, values: sig.containersPositivePct },
      ],
    }),
  );
}

async function load() {
  try {
    draw(await get("/api/officer/trends"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    for (const key of ["cases", "risk", "signals"]) showState(els[key], "error", { message: err.message || t.loadError, onRetry: load });
  }
}

document.getElementById("main").append(
  h("header", { class: "page-head" }, h("h1", { class: "page-title" }, t.title)),
  h("div", { class: "stack" }, card(t.casesTitle, "cases"), card(t.riskTitle, "risk"), card(t.signalsTitle, "signals", t.signalsSub)),
);
await mountShell({ active: "trends" });
load();
