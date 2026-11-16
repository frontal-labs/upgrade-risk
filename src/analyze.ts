import type { Cache } from "./cache";
import { detectUpdates, LOCKFILES } from "./detect";
import {
  extractBreaking,
  type NoteSection,
  type ProseBreaking,
} from "./extract";
import { extractWithLlm, type LlmOptions } from "./llm";
import { scoreUpdate } from "./score";
import { changelogInRange, findChangelog } from "./sources/changelog";
import {
  cachedGitHub,
  type GitHubSource,
  type SourceFiles,
  workspaceSourceFiles,
} from "./sources/github";
import { cachedNpm, type NpmSource } from "./sources/npm";
import { githubRepo, releasesInRange } from "./sources/releases";
import { diffTypes, type TypeChange } from "./typediff";
import {
  type BreakingChange,
  type DetectedUpdate,
  type PackageUpdate,
  type RiskLevel,
  type RiskReport,
  SCHEMA_ID,
  worstRisk,
} from "./types";
import { findUsages } from "./usage";

export interface AnalyzeOptions {
  cache: Cache;
  github: GitHubSource;
  /** Enables LLM extraction for notes the rules could not parse. Off unless set. */
  llm?: LlmOptions;
  now?: Date;
  npm: NpmSource;
  pr: number;
  repo: string;
  warn?: (message: string) => void;
  /** Scan this local checkout instead of downloading the PR head commit. */
  workspace?: string;
}

const npmPage = (name: string, version: string) =>
  `https://www.npmjs.com/package/${name}/v/${version}`;

function leafName(symbol: string): string {
  return symbol.split("::").pop() ?? symbol;
}

function typeChangeToBreaking(
  change: TypeChange,
  name: string,
  to: string
): ProseBreaking {
  const evidence = npmPage(name, to);
  if (change.kind === "renamed") {
    return {
      evidence,
      quote: change.quote,
      source: "type-diff",
      summary: `\`${change.symbol}\` was renamed to \`${change.renamedTo}\` (best guess from the type diff)`,
      symbols: [leafName(change.symbol)],
    };
  }
  if (change.kind === "removed") {
    return {
      evidence,
      quote: change.quote,
      source: "type-diff",
      summary: `\`${change.symbol}\` was removed from the public types`,
      symbols: [leafName(change.symbol)],
    };
  }
  return {
    evidence,
    quote: change.quote,
    source: "type-diff",
    summary: `\`${change.symbol}\` has a different type`,
    symbols: [leafName(change.symbol)],
  };
}

async function analyzeUpdate(
  update: { name: string; from: string; to: string },
  sources: {
    gh: GitHubSource;
    npm: NpmSource;
    repoFiles: SourceFiles;
    cache: Cache;
  },
  options: {
    headSha?: string;
    workspace?: string;
    warn: (message: string) => void;
    llm?: LlmOptions;
  }
): Promise<PackageUpdate> {
  const { name, from, to } = update;
  const { gh, npm, repoFiles, cache } = sources;
  const warn = options.warn;

  // Release notes first. Only when the repo has no releases in range do we read the changelog.
  const sections: NoteSection[] = [];
  const packument = await npm.packument(name).catch((error: unknown) => {
    warn(`${name}: registry lookup failed (${String(error)})`);
    return null;
  });
  const githubSlug = githubRepo(packument?.repository);
  if (githubSlug) {
    const releases = await gh.listReleases(githubSlug);
    for (const note of releasesInRange(releases, name, from, to)) {
      sections.push({
        evidence: note.url,
        source: "release-notes",
        text: note.body,
      });
    }
  }

  if (sections.length === 0) {
    try {
      const files = await npm.tarball(name, to);
      const changelog = findChangelog(files);
      const ranged = changelog ? changelogInRange(changelog, from, to) : [];
      if (ranged.length > 0) {
        sections.push({
          evidence: npmPage(name, to),
          source: "changelog",
          text: ranged.map((section) => section.text).join("\n"),
        });
      }
    } catch (error) {
      warn(`${name}: changelog could not be read (${String(error)})`);
    }
  }
  const notesFound = sections.length > 0;

  const types = await diffTypes(npm, name, from, to).catch((error: unknown) => {
    warn(`${name}: type diff failed (${String(error)})`);
    return { changes: [] as TypeChange[], found: false };
  });

  const ruleProse = extractBreaking(sections);
  const ruleItems: ProseBreaking[] = [
    ...ruleProse,
    ...types.changes.map((change) => typeChangeToBreaking(change, name, to)),
  ];
  // The LLM only runs when the rules found no breaking line in the notes. Its items are added
  // on top of the rule items, never instead of them.
  let llmItems: ProseBreaking[] = [];
  if (options.llm && sections.length > 0 && ruleProse.length === 0) {
    try {
      llmItems = await extractWithLlm(sections, options.llm);
    } catch (error) {
      warn(`${name}: LLM extraction failed (${String(error)})`);
    }
  }
  const breaking: BreakingChange[] = [...ruleItems, ...llmItems].map(
    (item) => ({
      ...item,
      usages: [],
    })
  );

  const symbols = [...new Set(breaking.flatMap((item) => item.symbols))];
  if (symbols.length > 0) {
    const scan = () => Promise.resolve(findUsages(repoFiles, name, symbols));
    const hits = options.workspace
      ? await scan()
      : await cache.memo(
          `usage:${options.headSha}:${name}:${symbols.join(",")}`,
          scan
        );
    for (const item of breaking) {
      const usages = new Map<
        string,
        { file: string; line: number; snippet: string }
      >();
      for (const hit of hits) {
        if (!item.symbols.includes(hit.symbol)) {
          continue;
        }
        const key = `${hit.file}:${hit.line}`;
        if (!usages.has(key)) {
          usages.set(key, {
            file: hit.file,
            line: hit.line,
            snippet: hit.snippet,
          });
        }
      }
      item.usages = [...usages.values()];
    }
  }

  // The rule-only risk is a floor: adding LLM items can raise the level, never lower it.
  const scoreInput = { from, notesFound, to, typesFound: types.found };
  const ruleRisk = scoreUpdate({
    ...scoreInput,
    breaking: breaking.slice(0, ruleItems.length),
  });
  const risk: RiskLevel = worstRisk([
    ruleRisk,
    scoreUpdate({ ...scoreInput, breaking }),
  ]);

  return {
    breaking,
    from,
    name,
    notesFound,
    risk,
    to,
    typesFound: types.found,
  };
}

export interface AnalysisResult {
  headSha?: string;
  report: RiskReport;
}

/** Analyzes one pull request and returns the risk report. Never runs code from the packages. */
export async function analyzePr(
  options: AnalyzeOptions
): Promise<AnalysisResult> {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const gh = cachedGitHub(options.github, options.cache);
  const npm = cachedNpm(options.npm, options.cache);
  const now = options.now ?? new Date();

  const pull = await gh.getPull(options.repo, options.pr);
  const changed = await gh.listPullFiles(options.repo, options.pr);
  const manifestChanged = changed.some((path) => {
    const name = path.slice(path.lastIndexOf("/") + 1);
    return (
      name === "package.json" || (LOCKFILES as readonly string[]).includes(name)
    );
  });
  const empty: RiskReport = {
    generatedAt: now.toISOString(),
    overall: "unknown",
    pr: options.pr,
    schema: SCHEMA_ID,
    updates: [],
  };
  if (!manifestChanged) {
    return { headSha: pull.headSha, report: empty };
  }

  // Every changed package.json counts, so monorepos work. Each one reads the lockfile in its own
  // directory, falling back to the root lockfile.
  const manifestPaths = [
    ...new Set(
      changed.filter(
        (path) => path === "package.json" || path.endsWith("/package.json")
      )
    ),
  ];
  const readLocks = async (ref: string, dir: string) => {
    const entries = await Promise.all(
      LOCKFILES.map(async (lock) => {
        const own = await gh.getFile(
          options.repo,
          ref,
          dir ? `${dir}/${lock}` : lock
        );
        const fallback =
          own ?? (dir ? await gh.getFile(options.repo, ref, lock) : null);
        return [lock, fallback] as const;
      })
    );
    return Object.fromEntries(entries);
  };

  const detected: DetectedUpdate[] = [];
  for (const manifestPath of manifestPaths) {
    const dir = manifestPath
      .slice(0, -"package.json".length)
      .replace(/\/$/, "");
    const baseManifest = await gh.getFile(
      options.repo,
      pull.baseSha,
      manifestPath
    );
    const headManifest = await gh.getFile(
      options.repo,
      pull.headSha,
      manifestPath
    );
    detected.push(
      ...detectUpdates({
        baseLock: await readLocks(pull.baseSha, dir),
        baseManifest,
        headLock: await readLocks(pull.headSha, dir),
        headManifest,
      })
    );
  }
  const unique = new Map<string, DetectedUpdate>();
  for (const update of detected) {
    const key = `${update.name}@${update.from}->${update.to}`;
    if (!unique.has(key)) {
      unique.set(key, update);
    }
  }
  const updatesFound = [...unique.values()];
  if (updatesFound.length === 0) {
    return { headSha: pull.headSha, report: empty };
  }

  const names = updatesFound.map((update) => update.name);
  const repoFiles = options.workspace
    ? workspaceSourceFiles(options.workspace, names)
    : await gh.sourceFiles(options.repo, pull.headSha, names);

  const updates: PackageUpdate[] = [];
  for (const update of updatesFound) {
    updates.push(
      await analyzeUpdate(
        update,
        { cache: options.cache, gh, npm, repoFiles },
        {
          headSha: pull.headSha,
          llm: options.llm,
          warn,
          workspace: options.workspace,
        }
      )
    );
  }

  return {
    headSha: pull.headSha,
    report: {
      generatedAt: now.toISOString(),
      overall: worstRisk(updates.map((update) => update.risk)),
      pr: options.pr,
      schema: SCHEMA_ID,
      updates,
    },
  };
}
