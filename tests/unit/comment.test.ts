import { describe, expect, test } from "bun:test";
import { COMMENT_MARKER, renderComment } from "../../src/comment";
import { parseRiskReport } from "../../src/schema";
import type { PackageUpdate, RiskReport } from "../../src/types";

const report: RiskReport = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  overall: "risky",
  pr: 7,
  schema: "frontal.upgrade-risk/v1",
  updates: [
    {
      breaking: [
        {
          evidence: "https://github.com/acme/lib/releases/tag/v2.0.0",
          quote: "- `parse` was removed, use `parseValue` instead",
          source: "release-notes",
          summary: "`parse` was removed",
          symbols: ["parse"],
          usages: [
            {
              file: "src/app.ts",
              line: 1,
              snippet: "import { parse } from 'lib'",
            },
          ],
        },
      ],
      from: "1.0.0",
      name: "lib",
      notesFound: true,
      risk: "risky",
      to: "2.0.0",
      typesFound: true,
    },
  ],
};

describe("renderComment", () => {
  test("includes the marker, headline, and a link per usage", () => {
    const md = renderComment(report, { repo: "acme/app", sha: "h1" });
    expect(md.startsWith(COMMENT_MARKER)).toBe(true);
    expect(md).toContain("1 breaking change affects 1 place in your code.");
    expect(md).toContain(
      "[src/app.ts:1](https://github.com/acme/app/blob/h1/src/app.ts#L1)"
    );
    expect(md).toContain("<b>lib</b> 1.0.0 → 2.0.0 · 🔴 Risky");
  });

  test("says plainly when nothing was found", () => {
    const md = renderComment(
      {
        ...report,
        overall: "unknown",
        updates: [
          {
            ...(report.updates[0] as PackageUpdate),
            breaking: [],
            notesFound: false,
            risk: "unknown",
            typesFound: false,
          },
        ],
      },
      { repo: "acme/app" }
    );
    expect(md).toContain("No release notes or type definitions were found");
  });
});

describe("parseRiskReport", () => {
  test("accepts a valid report and rejects a wrong schema version", () => {
    expect(parseRiskReport(report).overall).toBe("risky");
    expect(() =>
      parseRiskReport({ ...report, schema: "frontal.upgrade-risk/v2" })
    ).toThrow();
  });
});
