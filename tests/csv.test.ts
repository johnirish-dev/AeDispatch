import { describe, it, expect } from "vitest";
import { detectDelimiter, parseDelimited } from "../src/services/ingestion/csv";

describe("parseDelimited", () => {
  it("reads simple rows", () => {
    expect(parseDelimited("a,b\n1,2\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles CRLF and lone CR line ends", () => {
    expect(parseDelimited("a,b\r\n1,2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseDelimited("a,b\r1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("strips a UTF-8 BOM", () => {
    expect(parseDelimited("\uFEFFa,b\n1,2")[0]).toEqual(["a", "b"]);
  });

  it("handles quotes, commas, doubled quotes and line breaks inside fields", () => {
    expect(parseDelimited('a,b\n"x, y","say ""hi"""\n"line1\nline2",z')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["line1\nline2", "z"],
    ]);
  });

  it("keeps blank lines as empty records so row numbers stay true", () => {
    expect(parseDelimited("a,b\n\n1,2")).toEqual([["a", "b"], [""], ["1", "2"]]);
  });

  it("keeps empty cells", () => {
    expect(parseDelimited("a,b,c\n1,,3")).toEqual([["a", "b", "c"], ["1", "", "3"]]);
  });

  it("detects tab, comma and semicolon delimiters", () => {
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(parseDelimited("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
});
