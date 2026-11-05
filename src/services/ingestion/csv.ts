// A small CSV reader (no package needed). It handles a UTF-8 BOM, CRLF line
// ends, quoted fields with commas, quotes and line breaks, and picks the
// delimiter from the header, so text pasted from a spreadsheet (tabs) works too.

export type Delimiter = "," | "\t" | ";";

export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  const count = (ch: string) => firstLine.split(ch).length - 1;
  if (count("\t") > 0) return "\t";
  if (count(",") > 0) return ",";
  if (count(";") > 0) return ";";
  return ",";
}

/** Splits text into records of cells. Blank lines come back as [""] so row numbers stay true. */
export function parseDelimited(input: string, delimiter: Delimiter = detectDelimiter(input)): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}
