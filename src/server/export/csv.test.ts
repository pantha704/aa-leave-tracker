import { describe, expect, it } from "vitest";
import { csvCell, csvEscape, minutesToHours, neutralizeCsvFormula } from "./csv";

describe("csv formula neutralization", () => {
  it("prefixes Excel formula starters and quotes the cell", () => {
    expect(neutralizeCsvFormula('=HYPERLINK("http://evil.example","x")')).toBe(
      `'=HYPERLINK("http://evil.example","x")`,
    );
    expect(csvEscape('=HYPERLINK("http://evil.example","x")')).toBe(
      `"'=HYPERLINK(""http://evil.example"",""x"")"`,
    );
    expect(csvEscape("+cmd")).toBe(`"'+cmd"`);
    expect(csvEscape("-cmd")).toBe(`"'-cmd"`);
    expect(csvEscape("-=1+1")).toBe(`"'-=1+1"`);
    expect(csvEscape("@SUM(A1)")).toBe(`"'@SUM(A1)"`);
    expect(csvEscape("\t=1+1")).toBe(`"'\t=1+1"`);
  });

  it("does not treat numeric minutes or hour strings as a formula", () => {
    expect(csvCell(-480)).toBe("-480");
    expect(csvCell(680)).toBe("680");
    expect(csvEscape(minutesToHours(-480))).toBe("-8.00");
    expect(csvEscape(minutesToHours(680))).toBe("11.33");
  });
});
