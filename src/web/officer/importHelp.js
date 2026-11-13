// Groups the server's row messages for the "what is wrong" lines on the import card: the same
// mistake on several rows becomes one line. Only a summary; the server decides what is valid.

/** "Row 3: purok is missing." becomes "purok is missing." */
const withoutRow = (message) => String(message ?? "").replace(/^Row \d+:\s*/, "");

/** One row can have several problems in one message; this splits them into single sentences. */
function sentences(message) {
  return withoutRow(message)
    .split(/\.\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.endsWith(".") ? s : `${s}.`));
}

/** The same mistake on several rows, as { message, rows: [3, 12] }, in the order they first appear. */
export function problemGroups(rows) {
  const groups = new Map();
  for (const row of [...rows].sort((a, b) => a.row - b.row)) {
    if (row.ok) continue;
    for (const message of sentences(row.error)) {
      if (!groups.has(message)) groups.set(message, []);
      groups.get(message).push(row.row);
    }
  }
  return [...groups].map(([message, list]) => ({ message, rows: list }));
}
