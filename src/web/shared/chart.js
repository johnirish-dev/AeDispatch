// Line charts drawn as inline SVG, no library.
//
// lineChart() draws one line chart for a single series, or a row of small line charts (one
// per series) when there are several. Small charts are used instead of several lines in one
// chart because the lines would cross and overlap, and because the risk colours are close to
// each other (orange and red especially). Each small chart carries its own name and its latest
// value, so colour never has to carry the meaning.
//
// By default the small charts share one vertical scale, so they can be compared (the risk levels
// are all "number of barangays"). Pass `shared: false` when each series has its own unit, as with
// rain, temperature and report counts; every chart then has its own scale starting at zero, except a
// series that sets `zeroBased: false` (temperature), which is drawn between its own lowest and highest.
//
// Weeks with no data (a value of null) leave a gap in the line; they are never drawn as zero. When the newest
// week is not finished (`partialLast`), its last stretch is dashed and its marker hollow, because that week's
// figures are still growing and should not be read as a fall.
//
// The first time a chart scrolls into view its line draws itself from left to right, then the wash and the dots fade
// in. It plays once (not again on a resize) and is skipped when the person has asked for less motion.
//
// Each chart is drawn at the width it really has on the screen (and again when that changes), so the
// text stays readable on a phone. Every chart has the same hover layer: a hairline follows the pointer
// (or the arrow keys) from week to week and one tooltip lists every series for that week. The same
// numbers are always in a hidden table for screen readers.

import { h, s } from "./dom.js";

/** True when the system is set to reduce motion. */
const calm = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const LINE_WIDTH = 2;
const DOT_RADIUS = 4; // an 8 px marker
const TEXT = 11;

let chartCount = 0; // ids must be unique when a page has more than one chart

/** A tidy range for the vertical axis and the tick values between its ends. */
function niceScale(values, maxTicks, zeroBased) {
  const data = values.filter((v) => v !== null && v !== undefined);
  if (data.length === 0) return { min: 0, max: 1, step: 1, ticks: [0, 1] };
  const hi = Math.max(...data);
  const lo = zeroBased ? Math.min(0, ...data) : Math.min(...data);
  const range = Math.max(hi - lo, zeroBased ? 1 : 0.5);
  let step = 1;
  search: for (let power = 0.1; power <= 1_000_000; power *= 10) {
    for (const base of [1, 2, 5]) {
      step = base * power;
      if (Math.ceil(range / step - 1e-9) <= maxTicks) break search;
    }
  }
  const min = zeroBased ? 0 : Math.floor(lo / step + 1e-9) * step;
  let max = Math.ceil(hi / step - 1e-9) * step;
  if (max <= min) max = min + step;
  const ticks = [];
  for (let v = min; v <= max + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { min, max, step, ticks };
}

const formatTick = (v, step) => (step >= 1 ? String(Math.round(v)) : v.toFixed(1));
const shown = (v, unit) => (v === null || v === undefined ? "No data" : `${v}${unit ? ` ${unit}` : ""}`);

/**
 * One panel: a holder whose svg is drawn again whenever its width changes. `group` is the
 * object that owns the tooltip and the chosen week; the panel only reports what happened.
 */
function buildPanel({ labels, item, title, desc, scale, wide, id, group, partialLast }) {
  const H = wide ? 250 : 150;
  const holder = h("div", { class: "chart__plot" });
  const panel = { holder, item, svg: null, W: 0, xAt: () => 0, show: () => {} };

  function render(W) {
    const pad = { left: 34, right: wide ? 22 : 14, top: wide ? 26 : 14, bottom: 28 };
    const n = labels.length;
    const plotW = W - pad.left - pad.right;
    const x = (i) => (n === 1 ? pad.left + plotW / 2 : pad.left + (i * plotW) / (n - 1));
    const y = (v) => pad.top + (1 - (v - scale.min) / (scale.max - scale.min)) * (H - pad.top - pad.bottom);
    const base = y(scale.min);

    // The name for screen readers goes in aria-label: an svg <title> would also pop up as a browser tooltip over the chart.
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: "chart__svg", role: "img", tabindex: "0", "aria-label": `${title}. ${desc}` });

    // hairline grid and the vertical axis numbers
    scale.ticks.forEach((v) => {
      svg.appendChild(s("line", { x1: pad.left, x2: W - pad.right, y1: y(v), y2: y(v), stroke: "var(--line)", "stroke-width": 1 }));
      svg.appendChild(s("text", { x: pad.left - 8, y: y(v) + 4, "text-anchor": "end", "font-size": TEXT, fill: "var(--muted)" }, formatTick(v, scale.step)));
    });
    // the week labels: as many as fit, counting back from the newest week so the last one is always shown
    const every = Math.max(1, Math.ceil((n * 36) / Math.max(1, plotW + 36)));
    labels.forEach((label, i) => {
      if ((n - 1 - i) % every !== 0) return;
      svg.appendChild(s("text", { x: x(i), y: H - 8, "text-anchor": "middle", "font-size": TEXT, fill: "var(--muted)" }, label));
    });

    // the wash under the line fades out toward the axis
    const gradientId = `${id}-wash`;
    svg.appendChild(
      s(
        "defs",
        {},
        s(
          "linearGradient",
          { id: gradientId, x1: 0, y1: 0, x2: 0, y2: 1 },
          s("stop", { offset: "0%", style: `stop-color:${item.color};stop-opacity:0.2` }),
          s("stop", { offset: "100%", style: `stop-color:${item.color};stop-opacity:0` }),
        ),
      ),
    );

    // the hover layer sits under the line: a soft band over the chosen week, and a hairline through it
    const slot = n > 1 ? plotW / (n - 1) : plotW;
    const band = s("rect", { class: "chart__hover", x: 0, y: pad.top, height: base - pad.top, width: slot, rx: 6, fill: item.color, "fill-opacity": 0.07, visibility: "hidden" });
    svg.appendChild(band);

    // runs of weeks that have data: a gap in the data is a gap in the line
    const points = item.values.map((v, i) => (v === null || v === undefined ? null : [x(i), y(v)]));
    const runs = [];
    points.forEach((p, i) => {
      if (p === null) return;
      if (i > 0 && points[i - 1] !== null) runs[runs.length - 1].push(p);
      else runs.push([p]);
    });
    const draw = (run) => run.map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
    const dashLast = (run) => partialLast && run === runs[runs.length - 1] && run.length > 1 && points[n - 1] !== null;
    runs.forEach((run) => {
      // the wash under a line is only honest when the axis starts at zero
      if (run.length > 1 && item.zeroBased !== false) {
        svg.appendChild(s("path", { class: "chart__area", d: `${draw(run)} L${run[run.length - 1][0].toFixed(1)} ${base} L${run[0][0].toFixed(1)} ${base} Z`, fill: `url(#${gradientId})` }));
      }
      const solid = dashLast(run) ? run.slice(0, -1) : run;
      const line = { fill: "none", stroke: item.color, "stroke-width": LINE_WIDTH, "stroke-linejoin": "round", "stroke-linecap": "round" };
      // pathLength 1 lets the drawing animation use the same dash values for every line
      if (solid.length > 1) svg.appendChild(s("path", { class: "chart__line", pathLength: 1, d: draw(solid), ...line }));
      if (dashLast(run)) svg.appendChild(s("path", { class: "chart__tail", d: draw(run.slice(-2)), ...line, "stroke-dasharray": "3 5" }));
    });

    const cross = s("line", { class: "chart__hover", x1: 0, x2: 0, y1: pad.top, y2: base, stroke: "var(--line-strong)", "stroke-width": 1, visibility: "hidden" });
    svg.appendChild(cross);
    points.forEach((p, i) => {
      if (!p) return;
      const unfinished = partialLast && i === n - 1;
      svg.appendChild(s("circle", { class: "chart__dot", cx: p[0], cy: p[1], r: DOT_RADIUS, fill: unfinished ? "var(--surface)" : item.color, stroke: unfinished ? item.color : "var(--surface)", "stroke-width": 2 }));
    });
    const ring = s("circle", { class: "chart__hover", cx: 0, cy: 0, r: DOT_RADIUS + 3, fill: "none", stroke: item.color, "stroke-width": 2, visibility: "hidden" });
    svg.appendChild(ring);

    // a single wide series is labelled at its newest point, so the eye lands on the latest number
    const last = n - 1;
    if (wide && points[last]) {
      svg.appendChild(s("text", { class: "chart__end", x: points[last][0], y: points[last][1] - 12, "text-anchor": "middle", "font-size": 14, "font-weight": 700, fill: "var(--ink)" }, item.values[last]));
    }

    // the pointer area is bigger than the line: the whole plot, the nearest week wins
    const hit = s("rect", { x: pad.left - 6, y: 0, width: plotW + 12, height: H, fill: "transparent" });
    svg.appendChild(hit);

    const indexAt = (clientX) => {
      const box = svg.getBoundingClientRect();
      const unit = ((clientX - box.left) / box.width) * W;
      return Math.min(n - 1, Math.max(0, Math.round(((unit - pad.left) / Math.max(1, plotW)) * (n - 1))));
    };
    hit.addEventListener("pointermove", (event) => group.choose(panel, indexAt(event.clientX)));
    hit.addEventListener("pointerdown", (event) => group.choose(panel, indexAt(event.clientX)));
    // a finger lifting is not "leaving": the tooltip stays until the next touch elsewhere
    hit.addEventListener("pointerleave", (event) => {
      if (event.pointerType === "mouse") group.clear();
    });
    svg.addEventListener("focus", () => group.choose(panel, group.current ?? n - 1));
    svg.addEventListener("blur", () => group.clear());
    svg.addEventListener("keydown", (event) => group.key(panel, event));

    panel.svg = svg;
    panel.W = W;
    panel.xAt = x;
    panel.show = (i) => {
      const layer = [band, cross, ring];
      if (i === null) {
        layer.forEach((el) => el.setAttribute("visibility", "hidden"));
        return;
      }
      // they glide from week to week; the first time they appear they are placed without gliding
      const fresh = band.getAttribute("visibility") === "hidden";
      if (fresh) layer.forEach((el) => (el.style.transition = "none"));
      band.style.transform = `translate(${Math.max(pad.left - 4, Math.min(W - pad.right + 4 - slot, x(i) - slot / 2))}px, 0)`;
      cross.style.transform = `translate(${x(i)}px, 0)`;
      band.setAttribute("visibility", "visible");
      cross.setAttribute("visibility", "visible");
      if (points[i]) {
        ring.style.transform = `translate(${points[i][0]}px, ${points[i][1]}px)`;
        ring.setAttribute("visibility", "visible");
      } else {
        ring.setAttribute("visibility", "hidden");
      }
      if (fresh) {
        svg.getBoundingClientRect(); // apply the placement before turning the gliding back on
        layer.forEach((el) => (el.style.transition = ""));
      }
    };
    holder.replaceChildren(svg);
    if (group.current !== null) panel.show(group.current);
  }

  panel.render = render;
  render(wide ? 900 : 240); // a first guess; the real width is measured once the chart is on the page
  if (typeof ResizeObserver === "function") {
    new ResizeObserver((entries) => {
      const width = Math.round(entries[0].contentRect.width);
      if (width >= 120 && Math.abs(width - panel.W) > 3) render(width);
    }).observe(holder);
  }
  return panel;
}

function hiddenTable(caption, labels, columns) {
  return h(
    "table",
    { class: "sr-only" },
    h("caption", {}, caption),
    h("thead", {}, h("tr", {}, h("th", { scope: "col" }, "Week"), ...columns.map((c) => h("th", { scope: "col" }, c.unit ? `${c.name} (${c.unit})` : c.name)))),
    h("tbody", {}, ...labels.map((label, i) => h("tr", {}, h("th", { scope: "row" }, label), ...columns.map((c) => h("td", {}, c.values[i] === null || c.values[i] === undefined ? "no data" : c.values[i]))))),
  );
}

/**
 * `series` is a list of { name, color, values, unit?, zeroBased? }. One series gives one wide chart; several
 * give a row of small charts. `title` and `desc` name the whole chart for screen readers.
 */
export function lineChart({ labels, series, title, desc, shared = true, partialLast = false }) {
  const id = `chart-${++chartCount}`;
  const wide = series.length === 1;
  const everyValue = series.flatMap((item) => item.values);
  const sharedScale = shared || wide ? niceScale(everyValue, 4, true) : null;
  const root = h("div", { class: "chart" });
  const tip = h("div", { class: "chart__tip", role: "presentation", hidden: true });
  const last = labels.length - 1;

  const group = {
    current: null,
    choose(panel, i) {
      group.current = i;
      panels.forEach((p) => p.show(i));
      // only the chart under the pointer: the other charts show their own values (the week is still marked on all of them)
      const item = panel.item;
      tip.replaceChildren(
        h("p", { class: "chart__tip-head" }, partialLast && i === last ? `${labels[i]} · not finished yet` : labels[i]),
        h("p", { class: "chart__tip-row" }, h("i", { class: "chart__key", style: `background:${item.color}` }), h("strong", {}, shown(item.values[i], item.unit)), h("span", {}, item.name)),
      );
      const rootBox = root.getBoundingClientRect();
      const box = panel.svg.getBoundingClientRect();
      const px = box.left - rootBox.left + (panel.xAt(i) / panel.W) * box.width;
      tip.hidden = false;
      const width = tip.offsetWidth;
      const left = px + 14 + width > rootBox.width ? px - 14 - width : px + 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${box.top - rootBox.top + 8}px`;
    },
    clear() {
      group.current = null;
      panels.forEach((p) => p.show(null));
      tip.hidden = true;
    },
    key(panel, event) {
      if (event.key === "Escape") return group.clear();
      const jump = { Home: () => 0, End: () => last, ArrowLeft: () => Math.max(0, (group.current ?? last) - 1), ArrowRight: () => Math.min(last, (group.current ?? last) + 1) }[event.key];
      if (!jump) return undefined;
      event.preventDefault();
      return group.choose(panel, jump());
    },
  };

  const panels = series.map((item, k) =>
    buildPanel({
      labels,
      item,
      title: wide ? title : `${item.name}: ${title}`,
      desc,
      scale: sharedScale ?? niceScale(item.values, 4, item.zeroBased !== false),
      wide,
      id: `${id}-${k}`,
      group,
      partialLast,
    }),
  );
  document.addEventListener("pointerdown", (event) => {
    if (!root.contains(event.target)) group.clear();
  });

  if (wide) {
    root.append(panels[0].holder);
  } else {
    root.append(
      h(
        "div",
        { class: "chart__panels" },
        ...panels.map((panel, k) => {
          const latest = series[k].values[last];
          return h(
            "figure",
            { class: "chart__panel" },
            h(
              "figcaption",
              { class: "chart__panel-head" },
              h("span", {}, h("i", { class: "chart__key", style: `background:${series[k].color}` }), series[k].name),
              h("strong", {}, latest === null || latest === undefined ? "–" : latest, series[k].unit ? h("small", {}, ` ${series[k].unit}`) : null),
            ),
            panel.holder,
          );
        }),
      ),
    );
  }
  root.append(tip, hiddenTable(title, labels, series));

  // play the entrance once, when the chart first scrolls into view
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
