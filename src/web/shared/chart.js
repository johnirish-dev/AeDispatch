// Two charts drawn as inline SVG, no library. Each function returns a block with
// the chart, a hidden table with the same numbers (for screen readers) and, for
// the stacked chart, a legend. Colour alone never carries the meaning: bars have
// value labels and stacked segments are separated by a white gap and a count.

import { h, s } from "./dom.js";

const SLOT = 56; // width of one bar and its gap
const BAR = 38;
const LEFT = 10;
const BASELINE = 150;
const MAX_BAR_HEIGHT = 120;
const CASES_COLOR = "var(--green-mid)";   // earlier weeks
const CASES_LATEST = "var(--brand-dark)"; // the newest week, darker, so the eye lands on it

let chartCount = 0; // ids must be unique when a page has more than one chart

function frame(labels, title, desc, height) {
  const id = `chart-${++chartCount}`;
  return s(
    "svg",
    {
      viewBox: `0 0 ${LEFT * 2 + labels.length * SLOT - (SLOT - BAR)} ${height}`,
      role: "img",
      "aria-labelledby": `${id}-title ${id}-desc`,
      class: "chart__svg",
    },
    s("title", { id: `${id}-title` }, title),
    s("desc", { id: `${id}-desc` }, desc),
  );
}

function hiddenTable(caption, labels, columns) {
  return h(
    "table",
    { class: "sr-only" },
    h("caption", {}, caption),
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Week"), ...columns.map((c) => h("th", { scope: "col" }, c.name)))),
    h("tbody", {}, ...labels.map((label, i) => h("tr", {}, h("th", { scope: "row" }, label), ...columns.map((c) => h("td", {}, c.values[i]))))),
  );
}

function weekLabel(svg, x, label) {
  svg.appendChild(s("text", { x: x + BAR / 2, y: BASELINE + 22, "text-anchor": "middle", "font-size": 12, fill: "var(--muted)" }, label));
}

/** One series of bars with the value printed above each bar. */
export function barChart({ labels, values, title, desc }) {
  const svg = frame(labels, title, desc, BASELINE + 34);
  const top = Math.max(1, ...values);
  values.forEach((v, i) => {
    const x = LEFT + i * SLOT;
    const height = Math.round((v / top) * MAX_BAR_HEIGHT);
    // the <title> is the hover tooltip
    svg.appendChild(s("rect", { x, y: BASELINE - height, width: BAR, height, rx: Math.min(BAR / 2, height / 2), style: `fill:${i === values.length - 1 ? CASES_LATEST : CASES_COLOR}` }, s("title", {}, `${labels[i]}: ${v}`)));
    svg.appendChild(s("text", { x: x + BAR / 2, y: BASELINE - height - 6, "text-anchor": "middle", "font-size": 13, "font-weight": 700, fill: "var(--ink)" }, v));
    weekLabel(svg, x, labels[i]);
  });
  return h("div", { class: "chart" }, svg, hiddenTable(title, labels, [{ name: "Value", values }]));
}

/**
 * Stacked bars. `series` is listed bottom to top; each is { name, color, values }.
 * Segments tall enough to hold a number show their count.
 */
export function stackedBarChart({ labels, series, title, desc }) {
  const svg = frame(labels, title, desc, BASELINE + 34);
  const totals = labels.map((_, i) => series.reduce((sum, item) => sum + item.values[i], 0));
  const top = Math.max(1, ...totals);
  labels.forEach((label, i) => {
    const x = LEFT + i * SLOT;
    let y = BASELINE;
    series.forEach((item) => {
      const v = item.values[i];
      if (v <= 0) return;
      const height = (v / top) * MAX_BAR_HEIGHT;
      y -= height;
      // 1 px off each side makes the 2 px white gap between neighbouring segments
      svg.appendChild(
        s("rect", { x, y: y + 1, width: BAR, height: Math.max(0, height - 2), rx: 5, style: `fill:${item.color}` }, s("title", {}, `${label} · ${item.name}: ${v}`)),
      );
      if (height >= 18) {
        svg.appendChild(s("text", { x: x + BAR / 2, y: y + height / 2 + 5, "text-anchor": "middle", "font-size": 13, "font-weight": 700, fill: "#fff" }, v));
      }
    });
    weekLabel(svg, x, label);
  });

  const legend = h(
    "ul",
    { class: "legend", "aria-label": "Legend" },
    ...[...series].reverse().map((item) => h("li", {}, h("i", { style: `background:${item.color}` }), item.name)),
  );
  return h("div", { class: "chart" }, svg, legend, hiddenTable(title, labels, series));
}
