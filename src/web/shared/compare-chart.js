// A line chart with several lines in one frame (the risk levels; rain with temperature; two kinds of resident reports).
//
// A legend above the chart names every line and shows its newest value. Pressing a legend entry highlights that
// line (the others fade back); pressing it again, or another entry, changes or clears it. Hovering (or the arrow
// keys) marks one week and a tooltip lists every line for that week.
//
// Lines with `axis: "right"` use their own scale on the right edge, so rain (millimetres) and temperature (degrees)
// can share one chart; both axes use the same number of gridlines, and each axis is drawn in its line's colour.
// Weeks with no data (null) leave a gap; the newest week can be marked unfinished (dashed, hollow marker).
// The same numbers are in a hidden table for screen readers.

import { h, s } from "./dom.js";
import { hiddenTable } from "./chart.js";

/** True when the system is set to reduce motion. */
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const TEXT = 11;
/** The height used until the chart has been measured on the page (after that it takes the room it is given). */
const chartHeight = () => Math.max(180, Math.min(360, (typeof innerHeight === "number" ? innerHeight : 800) - 500));
let count = 0;

const isNum = (v) => v !== null && v !== undefined;
const label = (item) => (item.unit ? `${item.name} (${item.unit})` : item.name);
const shown = (v, unit) => (isNum(v) ? `${v}${unit ? ` ${unit}` : ""}` : "No data");
const tick = (v, step) => (step >= 1 ? String(Math.round(v)) : v.toFixed(1));

/** A tidy scale with exactly `intervals` gaps between the gridlines. */
function scaleFor(values, intervals, zeroBased) {
  const data = values.filter(isNum);
  if (data.length === 0) return { min: 0, max: intervals, step: 1 };
  const hi = Math.max(...data);
  const lo = zeroBased ? 0 : Math.min(...data);
  for (let power = 0.1; power <= 1_000_000; power *= 10) {
    for (const base of [1, 2, 5]) {
      const step = base * power;
      const min = zeroBased ? 0 : Math.floor(lo / step + 1e-9) * step;
      if (min + intervals * step >= hi - 1e-9) return { min, max: min + intervals * step, step };
    }
  }
  return { min: 0, max: intervals, step: 1 };
}

export function compareChart({ labels, series, title, desc, partialLast = false }) {
  const id = `cmp-${++count}`;
  const n = labels.length;
  const last = n - 1;
  const dual = series.some((item) => item.axis === "right");
  const left = series.filter((item) => item.axis !== "right");
  const right = series.filter((item) => item.axis === "right");
  const intervals = 4;
  const leftScale = scaleFor(left.flatMap((item) => item.values), intervals, left.every((item) => item.zeroBased !== false));
  const rightScale = dual ? scaleFor(right.flatMap((item) => item.values), intervals, right.every((item) => item.zeroBased !== false)) : null;
  const scaleOf = (item) => (item.axis === "right" ? rightScale : leftScale);

  const state = { focus: null, index: null };
  const root = h("div", { class: "chart chart--compare" });
  const tip = h("div", { class: "chart__tip", role: "presentation", hidden: true });
  const holder = h("div", { class: "chart__plot" });
  let view = { svg: null, W: 0, xAt: () => 0, groups: [], show: () => {} };

  // ---- the legend: one button per line
  const buttons = series.map((item, k) =>
    h(
      "button",
      { class: "legend__btn", type: "button", "aria-pressed": "false", onclick: () => setFocus(state.focus === k ? null : k) },
      h("i", { class: "chart__key", style: `background:${item.color}` }),
      h("span", {}, label(item)),
      h("strong", {}, isNum(item.values[last]) ? String(item.values[last]) : "–"),
    ),
  );
  const legend = h("div", { class: "legend", role: "group", "aria-label": title }, ...buttons);

  function setFocus(k) {
    state.focus = k;
    buttons.forEach((b, i) => {
      b.classList.toggle("is-on", i === k);
      b.setAttribute("aria-pressed", String(i === k));
    });
    applyFocus();
    if (state.index !== null) fillTip(state.index);
  }

  function applyFocus() {
    view.groups.forEach((g, k) => {
      const dim = state.focus !== null && state.focus !== k;
      g.setAttribute("opacity", dim ? "0.18" : "1");
      g.querySelectorAll(".cmp__line, .cmp__tail").forEach((p) => p.setAttribute("stroke-width", state.focus === k ? "3.5" : "2"));
      if (state.focus === k && g.nextSibling) g.parentNode.insertBefore(g, view.cross); // the chosen line is drawn on top
    });
  }

  function fillTip(i) {
    tip.replaceChildren(
      h("p", { class: "chart__tip-head" }, partialLast && i === last ? `${labels[i]} · not finished yet` : labels[i]),
      ...series.map((item, k) =>
        h(
          "p",
          { class: "chart__tip-row", style: state.focus !== null && state.focus !== k ? "opacity:0.45" : "" },
          h("i", { class: "chart__key", style: `background:${item.color}` }),
          h("strong", {}, isNum(item.values[i]) ? String(item.values[i]) : "–"),
          h("span", {}, item.unit ? `${item.name} (${item.unit})` : item.name),
        ),
      ),
    );
  }

  function choose(i) {
    state.index = i;
    view.show(i);
    fillTip(i);
    const rootBox = root.getBoundingClientRect();
    const box = view.svg.getBoundingClientRect();
    const px = box.left - rootBox.left + (view.xAt(i) / view.W) * box.width;
    tip.hidden = false;
    const width = tip.offsetWidth;
    const leftPos = px + 14 + width > rootBox.width ? px - 14 - width : px + 14;
    tip.style.left = `${Math.max(0, leftPos)}px`;
    tip.style.top = `${box.top - rootBox.top + 8}px`;
  }
  function clearHover() {
    state.index = null;
    view.show(null);
    tip.hidden = true;
  }

  function render(W, measuredH) {
    const HEIGHT = measuredH || view.H || chartHeight();
    const pad = { left: 40, right: dual ? 46 : 22, top: 24, bottom: 28 };
    const plotW = W - pad.left - pad.right;
    const x = (i) => (n === 1 ? pad.left + plotW / 2 : pad.left + (i * plotW) / (n - 1));
    const yIn = (scale) => (v) => pad.top + (1 - (v - scale.min) / (scale.max - scale.min)) * (HEIGHT - pad.top - pad.bottom);
    const base = HEIGHT - pad.bottom;
    const svg = s("svg", { viewBox: `0 0 ${W} ${HEIGHT}`, width: W, height: HEIGHT, class: "chart__svg", role: "img", tabindex: "0", "aria-label": `${title}. ${desc}` });

    // gridlines and the axes
    const yLeft = yIn(leftScale);
    const leftColor = dual && left.length === 1 ? left[0].color : "var(--muted)";
    const rightColor = right.length === 1 ? right[0].color : "var(--muted)";
    for (let k = 0; k <= intervals; k++) {
      const gy = pad.top + (k * (HEIGHT - pad.top - pad.bottom)) / intervals;
      svg.appendChild(s("line", { x1: pad.left, x2: W - pad.right, y1: gy, y2: gy, stroke: "var(--line)", "stroke-width": 1 }));
      const lv = leftScale.max - k * leftScale.step;
      svg.appendChild(s("text", { x: pad.left - 8, y: gy + 4, "text-anchor": "end", "font-size": TEXT, fill: leftColor }, tick(lv, leftScale.step)));
      if (dual) {
        const rv = rightScale.max - k * rightScale.step;
        svg.appendChild(s("text", { x: W - pad.right + 8, y: gy + 4, "text-anchor": "start", "font-size": TEXT, fill: rightColor }, tick(rv, rightScale.step)));
      }
    }
    const every = Math.max(1, Math.ceil((n * 36) / Math.max(1, plotW + 36)));
    labels.forEach((text, i) => {
      if ((n - 1 - i) % every !== 0) return;
      svg.appendChild(s("text", { x: x(i), y: HEIGHT - 8, "text-anchor": "middle", "font-size": TEXT, fill: "var(--muted)" }, text));
    });


    // one group per line: the line, its unfinished tail and its markers
    const groups = [];
    const pointsOf = series.map((item) => {
      const y = yIn(scaleOf(item));
      return item.values.map((v, i) => (isNum(v) ? [x(i), y(v)] : null));
    });
    series.forEach((item, k) => {
      const g = s("g", { "data-series": k });
      const points = pointsOf[k];
      const runs = [];
      points.forEach((p, i) => {
        if (p === null) return;
        if (i > 0 && points[i - 1] !== null) runs[runs.length - 1].push(p);
        else runs.push([p]);
      });
      const path = (run) => run.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
      const style = { fill: "none", stroke: item.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" };
      runs.forEach((run) => {
        const dashed = partialLast && run === runs[runs.length - 1] && run.length > 1 && points[last] !== null;
        const solid = dashed ? run.slice(0, -1) : run;
        if (solid.length > 1) g.appendChild(s("path", { class: "cmp__line chart__line", pathLength: 1, d: path(solid), ...style }));
        if (dashed) g.appendChild(s("path", { class: "cmp__tail chart__tail", d: path(run.slice(-2)), ...style, "stroke-dasharray": "3 5" }));
      });
      points.forEach((p, i) => {
        if (!p) return;
        const open = partialLast && i === last;
        g.appendChild(s("circle", { class: "chart__dot", cx: p[0], cy: p[1], r: 4, fill: open ? "var(--surface)" : item.color, stroke: open ? item.color : "var(--surface)", "stroke-width": open ? 2 : 1.5 }));
      });
      svg.appendChild(g);
      groups.push(g);
    });

    const cross = s("line", { x1: 0, x2: 0, y1: pad.top, y2: base, stroke: "var(--line-strong)", "stroke-width": 1, visibility: "hidden", class: "chart__hover" });
    svg.appendChild(cross);
    const rings = series.map((item) => {
      const ring = s("circle", { cx: 0, cy: 0, r: 7, fill: "none", stroke: item.color, "stroke-width": 2, visibility: "hidden", class: "chart__hover" });
      svg.appendChild(ring);
      return ring;
    });

    const hit = s("rect", { x: pad.left - 6, y: 0, width: plotW + 12, height: HEIGHT, fill: "transparent" });
    svg.appendChild(hit);
    const indexAt = (clientX) => {
      const box = svg.getBoundingClientRect();
      const unit = ((clientX - box.left) / box.width) * W;
      return Math.min(last, Math.max(0, Math.round(((unit - pad.left) / Math.max(1, plotW)) * last)));
    };
    hit.addEventListener("pointermove", (event) => choose(indexAt(event.clientX)));
    hit.addEventListener("pointerdown", (event) => choose(indexAt(event.clientX)));
    hit.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") clearHover();
    });
    svg.addEventListener("focus", () => choose(state.index ?? last));
    svg.addEventListener("blur", clearHover);
    svg.addEventListener("keydown", (event) => {
      if (event.key === "Escape") return clearHover();
      const jump = { Home: () => 0, End: () => last, ArrowLeft: () => Math.max(0, (state.index ?? last) - 1), ArrowRight: () => Math.min(last, (state.index ?? last) + 1) }[event.key];
      if (!jump) return undefined;
      event.preventDefault();
      return choose(jump());
    });

    view = {
      svg,
      W,
      H: HEIGHT,
      xAt: x,
      groups,
      cross,
      show(i) {
        const all = [cross, ...rings];
        if (i === null) return all.forEach((el) => el.setAttribute("visibility", "hidden"));
        cross.setAttribute("x1", x(i));
        cross.setAttribute("x2", x(i));
        cross.setAttribute("visibility", "visible");
        rings.forEach((ring, k) => {
          const p = pointsOf[k][i];
          if (!p) return ring.setAttribute("visibility", "hidden");
          ring.setAttribute("cx", p[0]);
          ring.setAttribute("cy", p[1]);
          ring.setAttribute("visibility", state.focus === null || state.focus === k ? "visible" : "hidden");
        });
      },
    };
    holder.replaceChildren(svg);
    applyFocus();
    if (state.index !== null) view.show(state.index);
  }

  render(900); // a first guess; the real width is measured once the chart is on the page
  if (typeof ResizeObserver === "function") {
    new ResizeObserver((entries) => {
      const width = Math.round(entries[0].contentRect.width);
      const height = Math.round(entries[0].contentRect.height);
      if (width >= 200 && (Math.abs(width - view.W) > 3 || (height >= 160 && Math.abs(height - view.H) > 3))) render(width, height);
    }).observe(holder);
  }
  document.addEventListener("pointerdown", (event) => {
    if (!root.contains(event.target)) clearHover();
  });

  root.append(legend, holder, tip, hiddenTable(title, labels, series));

  // the same entrance as the other charts: the lines draw from left to right once, when the chart first scrolls into view
  if (calm() || typeof IntersectionObserver !== "function") {
    root.classList.add("chart--done");
  } else {
    const watcher = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watcher.disconnect();
      root.classList.add("chart--go");
      window.setTimeout(() => root.classList.add("chart--done"), 1500);
    }, { threshold: 0.3 });
    watcher.observe(root);
  }
  return root;
}
