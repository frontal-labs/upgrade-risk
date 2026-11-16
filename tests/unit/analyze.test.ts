import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzePr } from "../../src/analyze";
import { createCache } from "../../src/cache";
import type { GitHubSource } from "../../src/sources/github";
import type { NpmSource, PackageFiles } from "../../src/sources/npm";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const v1Types = "export declare function parse(input: string): number;\n";
const v2Types = "export declare function parseValue(input: string): number;\n";

const manifest = (range: string) =>
  JSON.stringify({ dependencies: { lib: range } });
const lock = (version: string) =>
  JSON.stringify({ packages: { "node_modules/lib": { version } } });

function fakeGitHub(
  overrides: { app?: string; releases?: unknown[] } = {}
): GitHubSource {
  const files: Record<string, Record<string, string | null>> = {
    b1: {
      "package-lock.json": lock("1.0.0"),
      "package.json": manifest("^1.0.0"),
    },
    h1: {
      "package-lock.json": lock("2.0.0"),
      "package.json": manifest("^2.0.0"),
    },
  };
  return {
    async getFile(_repo, ref, path) {
      return files[ref]?.[path] ?? null;
    },
    async getPull(_repo, pr) {
      return {
        author: "dependabot[bot]",
        baseSha: "b1",
        headSha: "h1",
        number: pr,
        title: "Bump lib",
      };
    },
    async listPullFiles() {
      return ["package.json", "package-lock.json"];
    },
    async listReleases() {
      return (overrides.releases ?? [
        {
          body: "## Breaking changes\n- `parse` was removed, use `parseValue` instead\n",
          draft: false,
          name: "v2",
          prerelease: false,
          tag: "v2.0.0",
          url: "https://github.com/acme/lib/releases/tag/v2.0.0",
        },
      ]) as never;
    },
    async sourceFiles() {
      return overrides.app === undefined
        ? { "src/app.ts": "import { parse } from 'lib'\nparse('x')\n" }
        : { "src/app.ts": overrides.app };
    },
  };
}

const fakeNpm: NpmSource = {
  async packument() {
    return {
      name: "lib",
      repository: "git+https://github.com/acme/lib.git",
      versions: { "1.0.0": { tarball: "a" }, "2.0.0": { tarball: "b" } },
    };
  },
  async tarball(_name, version): Promise<PackageFiles> {
    const types = version === "1.0.0" ? v1Types : v2Types;
    return {
      "index.d.ts": types,
      "package.json": JSON.stringify({ name: "lib", types: "index.d.ts" }),
    };
  },
};

const never = (): never => {
  throw new Error("network must not be used on replay");
};

describe("analyzePr", () => {
  test("risky when a removed symbol is imported by the repo", async () => {
    const { report, headSha } = await analyzePr({
      cache: createCache(),
      github: fakeGitHub(),
      now: new Date("2026-01-01T00:00:00Z"),
      npm: fakeNpm,
      pr: 7,
      repo: "acme/app",
    });
    expect(headSha).toBe("h1");
    expect(report.overall).toBe("risky");
    expect(report.schema).toBe("frontal.upgrade-risk/v1");
    const [update] = report.updates;
    expect(update).toMatchObject({
      from: "1.0.0",
      name: "lib",
      risk: "risky",
      to: "2.0.0",
    });
    const usageLines = update?.breaking.flatMap((b) =>
      b.usages.map((u) => u.line)
    );
    expect(usageLines).toEqual(expect.arrayContaining([1, 2]));
  });

  test("safe when the removed symbol is not used", async () => {
    const { report } = await analyzePr({
      cache: createCache(),
      github: fakeGitHub({ app: "import { other } from 'lib'\n" }),
      npm: fakeNpm,
      pr: 8,
      repo: "acme/app",
    });
    expect(report.overall).toBe("safe");
    expect(report.updates[0]?.notesFound).toBe(true);
    expect(report.updates[0]?.typesFound).toBe(true);
  });

  test("unknown when there are no notes, no changelog and no types", async () => {
    const npm: NpmSource = {
      packument: fakeNpm.packument,
      async tarball() {
        return { "package.json": '{"name":"lib"}' };
      },
    };
    const { report } = await analyzePr({
      cache: createCache(),
      github: fakeGitHub({ releases: [] }),
      npm,
      pr: 9,
      repo: "acme/app",
      warn: () => undefined,
    });
    expect(report.overall).toBe("unknown");
    expect(report.updates[0]?.notesFound).toBe(false);
  });

  test("replays a recorded run without touching the network", async () => {
    const dir = mkdtempSync(join(tmpdir(), "upgrade-risk-"));
    dirs.push(dir);
    const recorded = await analyzePr({
      cache: createCache({ dir, mode: "record" }),
      github: fakeGitHub(),
      now: new Date("2026-01-01T00:00:00Z"),
      npm: fakeNpm,
      pr: 10,
      repo: "acme/app",
    });
    const replayed = await analyzePr({
      cache: createCache({ dir, mode: "replay" }),
      github: {
        getFile: never,
        getPull: never,
        listPullFiles: never,
        listReleases: never,
        sourceFiles: never,
      },
      now: new Date("2026-01-01T00:00:00Z"),
      npm: { packument: never, tarball: never },
      pr: 10,
      repo: "acme/app",
    });
    expect(replayed.report).toEqual(recorded.report);
  });
});
