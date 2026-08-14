import { describe, expect, it } from "vitest";
import { csvCell, csvEscape, neutralizeCsvFormula } from "./csv";

describe("csv formula neutralization", () => {
  it("prefixes Excel formula starters and quotes the cell", () => {
    expect(neutralizeCsvFormula('=HYPERLINK("http://evil.example","x")')).toBe(
      `'=HYPERLINK("http://evil.example","x")`,
    );
    expect(csvEscape('=HYPERLINK("http://evil.example","x")')).toBe(
      `"'=HYPERLINK(""http://evil.example"",""x"")"`,
    );
    expect(csvEscape("+cmd")).toBe(`"'+cmd"`);
    expect(csvEscape("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvEscape("\t=1+1")).toBe(`"'\t=1+1"`);
  });

  it("does not treat numeric minutes as a formula", () => {
    expect(csvCell(-480)).toBe("-480");
    expect(csvCell(680)).toBe("680");
  });
});
