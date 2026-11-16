import { readFileSync } from "node:fs";
import { z } from "zod";
import defaults from "../config/tags.json";
import type { RiskLevel } from "./types";

const Label = z.object({
  description: z.string().optional(),
  icon: z.string().optional(),
  label: z.string().min(1),
});
const SourceLabel = z.object({ label: z.string().min(1) });

const HEADLINE_KEYS = [
  "safe",
  "risky",
  "review",
  "partial",
  "unknown",
] as const;
const RISK_KEYS = ["safe", "review", "unknown", "risky"] as const;
const SOURCE_KEYS = ["release-notes", "changelog", "type-diff", "llm"] as const;

/** Every key is optional in an override file; missing keys fall back to config/tags.json. */
const TagFile = z.object({
  footer: z.string().optional(),
  headlines: z
    .object(
      Object.fromEntries(
        HEADLINE_KEYS.map((key) => [key, z.string().optional()])
      )
    )
    .partial()
    .optional(),
  risk: z
    .object(
      Object.fromEntries(
        RISK_KEYS.map((key) => [key, Label.partial().optional()])
      )
    )
    .partial()
    .optional(),
  sources: z
    .object(
      Object.fromEntries(
        SOURCE_KEYS.map((key) => [key, SourceLabel.optional()])
      )
    )
    .partial()
    .optional(),
});

export type TagFileInput = z.input<typeof TagFile>;

export interface Tags {
  footer: string;
  headlines: Record<(typeof HEADLINE_KEYS)[number], string>;
  risk: Record<RiskLevel, { label: string; icon: string; description: string }>;
  sources: Record<(typeof SOURCE_KEYS)[number], string>;
}

const base = TagFile.parse(defaults);

function merge(override: TagFileInput | undefined): Tags {
  const file = TagFile.parse(override ?? {});
  const pick = <T extends Record<string, unknown>>(
    a: T,
    b: Partial<T> | undefined
  ): T => ({
    ...a,
    ...(b ?? {}),
  });
  const riskBase = base.risk ?? {};
  const risk = Object.fromEntries(
    RISK_KEYS.map((key) => {
      const merged = { ...riskBase[key], ...(file.risk?.[key] ?? {}) };
      return [
        key,
        {
          description: merged.description ?? "",
          icon: merged.icon ?? "",
          label: merged.label ?? key,
        },
      ];
    })
  ) as Tags["risk"];
  const headlines = pick(
    base.headlines as Record<string, string>,
    file.headlines
  ) as Tags["headlines"];
  const sources = Object.fromEntries(
    SOURCE_KEYS.map((key) => [
      key,
      (file.sources?.[key] ?? base.sources?.[key])?.label ?? key,
    ])
  ) as Tags["sources"];
  return { footer: file.footer ?? base.footer ?? "", headlines, risk, sources };
}

/** The tags in use: the defaults, with an optional override file applied on top. */
export function loadTags(path?: string): Tags {
  if (!path) {
    return merge(undefined);
  }
  return merge(JSON.parse(readFileSync(path, "utf8")) as TagFileInput);
}

export function parseTagFile(value: unknown): TagFileInput {
  return TagFile.parse(value);
}

export const defaultTags: Tags = merge(undefined);
