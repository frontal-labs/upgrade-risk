import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderComment } from "../../src/comment";
import { defaultTags, loadTags } from "../../src/config";
import type { RiskReport } from "../../src/types";

const report: RiskReport = {
  generatedAt: "2026-01-01T00:00:00.000Z",
  overall: "risky",
  pr: 1,
  schema: "frontal.upgrade-risk/v1",
  updates: [
    {
      breaking: [
        {
          evidence: "https://e",
          quote: "- x",
          source: "llm",
          summary: "x",
          symbols: ["x"],
          usages: [{ file: "a.ts", line: 2, snippet: "x()" }],
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

describe("tags config", () => {
  test("defaults come from config/tags.json", () => {
    expect(defaultTags.risk.risky.label).toBe("Risky");
    expect(defaultTags.risk.risky.icon).toBe("🔴");
    expect(defaultTags.sources.llm).toBe("🤖 LLM extracted");
  });

  test("an override file renames labels and keeps the rest", () => {
    const dir = mkdtempSync(join(tmpdir(), "tags-"));
    try {
      const file = join(dir, "tags.json");
      writeFileSync(
        file,
        JSON.stringify({
          headlines: { risky: "{breaking} hit {places}." },
          risk: { risky: { icon: "⛔", label: "Breaking" } },
          sources: { "type-diff": { label: "typings" } },
        })
      );
      const tags = loadTags(file);
      expect(tags.risk.risky.label).toBe("Breaking");
      expect(tags.risk.safe.label).toBe("Safe");
      expect(tags.sources["type-diff"]).toBe("typings");
      const md = renderComment(report, { repo: "a/b", sha: "h", tags });
      expect(md).toContain("⛔ Breaking");
      expect(md).toContain("1 breaking change hit 1 place.");
      expect(md).toContain("🤖 LLM extracted");
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });

  test("rejects an override with a non-string label", () => {
    const dir = mkdtempSync(join(tmpdir(), "tags-"));
    try {
      const file = join(dir, "bad.json");
      writeFileSync(file, JSON.stringify({ risk: { risky: { label: 3 } } }));
      expect(() => loadTags(file)).toThrow();
    } finally {
      rmSync(dir, { force: true, recursive: true });
    }
  });
});
