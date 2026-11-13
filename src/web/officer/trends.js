// Trends: confirmed cases and the number of barangays at each risk level, week by
// week for the past eight weeks. The numbers come from /api/officer/trends.

import { ApiError, get } from "../shared/api.js";
import { barChart, stackedBarChart } from "../shared/chart.js";
import { clear, h, showState } from "../shared/dom.js";
import * as fmt from "../shared/format.js";
import { mountShell } from "../shared/shell.js";
import { strings } from "../shared/strings.js";

const t = strings.officer.trends;
const els = {};

function card(title, sub, key) {
  els[key] = h("div", {}, h("span", { class: "skeleton chart-skeleton" }));
  return h("section", { class: "card" }, h("h2", {}, title), h("p", { class: "card__sub" }, sub), els[key]);
}

function draw(trends) {
  const labels = trends.weeks.map(fmt.weekShort);
  els.sub.textContent = `${t.sub} · ${t.weekNote(trends.weeks[trends.weeks.length - 1])}`;
  clear(els.cases).append(barChart({ labels, values: trends.casesPerWeek, title: t.casesChartTitle, desc: t.casesChartDesc }));
  const count = (level) => trends.riskPerWeek.map((week) => week[level]);
  clear(els.risk).append(
    stackedBarChart({
      labels,
      title: t.riskChartTitle,
      desc: t.riskChartDesc,
      series: [
        { name: fmt.riskLabel("low"), color: "var(--low-fill)", values: count("low") },
        { name: fmt.riskLabel("moderate"), color: "var(--mod-fill)", values: count("moderate") },
        { name: fmt.riskLabel("elevated"), color: "var(--elev-fill)", values: count("elevated") },
        { name: fmt.riskLabel("high"), color: "var(--high-fill)", values: count("high") },
      ],
    }),
  );
}

async function load() {
  try {
    draw(await get("/api/officer/trends"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    showState(els.cases, "error", { message: err.message || t.loadError, onRetry: load });
    showState(els.risk, "error", { message: err.message || t.loadError, onRetry: load });
  }
}

els.sub = h("p", { class: "page-head__sub" }, t.sub);
document.getElementById("main").append(
  h("header", { class: "page-head" }, h("div", {}, h("h1", { class: "page-title" }, t.title), els.sub)),
  h("div", { class: "grid grid--2" }, card(t.casesTitle, t.casesSub, "cases"), card(t.riskTitle, t.riskSub, "risk")),
);
await mountShell({ active: "trends" });
load();
