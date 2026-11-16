import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { Octokit } from "@octokit/rest";
import type { Cache } from "../cache";
import { readTarGz } from "../tar";

export interface PullInfo {
  author: string;
  baseSha: string;
  headSha: string;
  number: number;
  title: string;
}

export interface ReleaseInfo {
  body: string;
  draft: boolean;
  name: string;
  prerelease: boolean;
  tag: string;
  url: string;
}

/** Repo-relative path to file text. */
export type SourceFiles = Record<string, string>;

export interface GitHubSource {
  getFile(repo: string, ref: string, path: string): Promise<string | null>;
  getPull(repo: string, pr: number): Promise<PullInfo>;
  listPullFiles(repo: string, pr: number): Promise<string[]>;
  listReleases(repo: string): Promise<ReleaseInfo[]>;
  /** Source files at `ref` whose text mentions at least one of `names`. */
  sourceFiles(repo: string, ref: string, names: string[]): Promise<SourceFiles>;
}

const SOURCE_EXTENSIONS = /\.(?:[cm]?[jt]sx?)$/;
const MAX_FILE_BYTES = 1_000_000;

export function isSourcePath(path: string): boolean {
  return (
    SOURCE_EXTENSIONS.test(path) && !path.split("/").includes("node_modules")
  );
}

function keepMentioning(files: SourceFiles, names: string[]): SourceFiles {
  const out: SourceFiles = {};
  for (const [path, text] of Object.entries(files)) {
    if (
      text.length <= MAX_FILE_BYTES &&
      names.some((name) => text.includes(name))
    ) {
      out[path] = text;
    }
  }
  return out;
}

export function createGitHubSource(token?: string): GitHubSource {
  const octokit = new Octokit({ auth: token });

  return {
    async getFile(repo, ref, path) {
      const [owner, name] = splitRepo(repo);
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          path,
          ref,
          repo: name,
        });
        if (
          Array.isArray(data) ||
          data.type !== "file" ||
          !("content" in data)
        ) {
          return null;
        }
        return Buffer.from(data.content, "base64").toString("utf8");
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },
    async getPull(repo, pr) {
      const [owner, name] = splitRepo(repo);
      const { data } = await octokit.pulls.get({
        owner,
        pull_number: pr,
        repo: name,
      });
      return {
        author: data.user?.login ?? "",
        baseSha: data.base.sha,
        headSha: data.head.sha,
        number: data.number,
        title: data.title,
      };
    },

    async listPullFiles(repo, pr) {
      const [owner, name] = splitRepo(repo);
      const files = await octokit.paginate(octokit.pulls.listFiles, {
        owner,
        per_page: 100,
        pull_number: pr,
        repo: name,
      });
      return files.map((file) => file.filename);
    },

    async listReleases(repo) {
      const [owner, name] = splitRepo(repo);
      let releases: Awaited<
        ReturnType<typeof octokit.repos.listReleases>
      >["data"];
      try {
        releases = await octokit.paginate(octokit.repos.listReleases, {
          owner,
          per_page: 100,
          repo: name,
        });
      } catch (error) {
        // A repository that was renamed or deleted has no releases to read.
        if (isNotFound(error)) {
          return [];
        }
        throw error;
      }
      return releases.map((release) => ({
        body: release.body ?? "",
        draft: release.draft,
        name: release.name ?? "",
        prerelease: release.prerelease,
        tag: release.tag_name,
        url: release.html_url,
      }));
    },

    async sourceFiles(repo, ref, names) {
      const [owner, name] = splitRepo(repo);
      const { data } = await octokit.repos.downloadTarballArchive({
        owner,
        ref,
        repo: name,
      });
      const files = readTarGz(new Uint8Array(data as ArrayBuffer), (entry) => {
        const relativePath = entry.slice(entry.indexOf("/") + 1);
        return isSourcePath(relativePath) ? relativePath : undefined;
      });
      return keepMentioning(files, names);
    },
  };
}

/** Reads source files from a local checkout instead of GitHub. */
export function workspaceSourceFiles(
  dir: string,
  names: string[]
): SourceFiles {
  const files: SourceFiles = {};
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry === ".git") {
        continue;
      }
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        const rel = relative(dir, full).split(sep).join("/");
        if (isSourcePath(rel)) {
          files[rel] = readFileSync(full, "utf8");
        }
      }
    }
  };
  walk(dir);
  return keepMentioning(files, names);
}

/** Wraps a GitHub source so every call is memoized in the cache. */
export function cachedGitHub(source: GitHubSource, cache: Cache): GitHubSource {
  return {
    getFile: (repo, ref, path) =>
      cache.memo(`gh:file:${repo}@${ref}:${path}`, () =>
        source.getFile(repo, ref, path)
      ),
    getPull: (repo, pr) =>
      cache.memo(`gh:pull:${repo}#${pr}`, () => source.getPull(repo, pr)),
    listPullFiles: (repo, pr) =>
      cache.memo(`gh:pull-files:${repo}#${pr}`, () =>
        source.listPullFiles(repo, pr)
      ),
    listReleases: (repo) =>
      cache.memo(`gh:releases:${repo}`, () => source.listReleases(repo)),
    sourceFiles: (repo, ref, names) => {
      const sorted = [...names].sort();
      return cache.memo(`gh:sources:${repo}@${ref}:${sorted.join(",")}`, () =>
        source.sourceFiles(repo, ref, sorted)
      );
    },
  };
}

function splitRepo(repo: string): [string, string] {
  const [owner, name] = repo.split("/");
  if (!(owner && name)) {
    throw new Error(`Repository must be owner/name, got "${repo}"`);
  }
  return [owner, name];
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 404
  );
}
