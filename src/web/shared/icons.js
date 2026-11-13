// One small icon set, drawn as SVG in a single stroke weight so every icon looks
// like it belongs to the same family. Icons are decoration next to a text label
// (or carry their own aria-label where they stand alone).

import { s } from "./dom.js";

const PATHS = {
  overview: ["M4 5h7v7H4z", "M13 5h7v4h-7z", "M13 11h7v8h-7z", "M4 14h7v5H4z"],
  queue: ["M4 6h10", "M4 12h16", "M4 18h7", "M17 4v5", "M15 7l2 2 2-2"],
  import: ["M12 15V4", "M8 8l4-4 4 4", "M5 15v4h14v-4"],
  profiles: ["M12 21s-6-5.2-6-10a6 6 0 0112 0c0 4.8-6 10-6 10z", "M12 8.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z"],
  trends: ["M4 19V5", "M4 19h16", "M8 15l3-4 3 2 4-6"],
  activity: ["M9 6h11", "M9 12h11", "M9 18h11", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
  demo: ["M5 7h9", "M18 7h1", "M5 17h1", "M10 17h9", "M16 5v4", "M8 15v4"],
  search: ["M11 4a7 7 0 100 14 7 7 0 000-14z", "M20 20l-4-4"],
  up: ["M7 17L17 7", "M9 7h8v8"],
  down: ["M7 7l10 10", "M17 9v8H9"],
  flat: ["M5 12h14"],
  check: ["M5 12.5l4.5 4.5L19 7"],
  plus: ["M12 5v14", "M5 12h14"],
  flag: ["M6 21V4", "M6 5h11l-2.5 4L17 13H6"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  file: ["M7 3h7l5 5v13H7z", "M14 3v5h5", "M10 13h6", "M10 17h6"],
  clipboard: ["M9 4h6v3H9z", "M7 5.5H6a1 1 0 00-1 1V19a1 1 0 001 1h12a1 1 0 001-1V6.5a1 1 0 00-1-1h-1", "M9 13.5l2 2 4-4"],
  chevron: ["M9 6l6 6-6 6"],
  caretDown: ["M6 9l6 6 6-6"],
  filter: ["M4 5h16l-6.2 7.6V19l-3.6 1.6v-8z"],
  calendar: ["M5 6.5h14v12.5H5z", "M5 10.5h14", "M9 4.5v4", "M15 4.5v4"],
  sortHigh: ["M12 5v14", "M7 14l5 5 5-5"],
  sortLow: ["M12 19V5", "M7 10l5-5 5 5"],
  sortName: ["M4 18l3.5-10L11 18", "M5.3 14.5h4.4", "M14 8h5l-5 8h5"],
  sort: ["M8 20V4", "M5 7l3-3 3 3", "M16 4v16", "M13 17l3 3 3-3"],
  signout: ["M10 5H5v14h5", "M15 8l4 4-4 4", "M19 12H9"],
  external: ["M14 5h5v5", "M19 5l-8 8", "M18 14v5H5V6h5"],
};

/** icon("up") returns an <svg> that inherits the text colour. */
export function icon(name, { label = null } = {}) {
  return s(
    "svg",
    {
      class: "icon",
      viewBox: "0 0 24 24",
      "aria-hidden": label ? null : "true",
      role: label ? "img" : null,
      "aria-label": label,
      focusable: "false",
    },
    ...(PATHS[name] ?? []).map((d) => s("path", { d })),
  );
}

/**
 * The sidebar icon: a panel with its left column marked. A chevron in the column shows
 * which way the click moves it (left to close, right to open). Own viewBox and a finer line.
 */
export function sidebarIcon(collapsed) {
  return s(
    "svg",
    { class: "icon icon--panel", viewBox: "-0.5 -0.5 16 16", "aria-hidden": "true", focusable: "false" },
    s("path", {
      d: "M12.7769375 14.284625H2.2230625c-0.8326875 0 -1.5076875 -0.675 -1.5076875 -1.5076875l0 -10.553875c0 -0.8326875 0.675 -1.5076875 1.5076875 -1.5076875h10.553875c0.8326875 0 1.5076875 0.675 1.5076875 1.5076875v10.553875c0 0.8326875 -0.675 1.5076875 -1.5076875 1.5076875Z",
    }),
    s("path", { d: collapsed ? "M2.6 5.9923125 3.91925 7.5 2.6 9.0076875" : "M3.91925 5.9923125 2.6 7.5l1.31925 1.5076875" }),
    s("path", { d: "M5.615375 14.284625V0.715375" }),
  );
}
