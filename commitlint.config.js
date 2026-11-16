export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [(message) => message === "Version Packages"],
  rules: {
    "body-max-line-length": [2, "always", 72],
    "subject-case": [2, "never", ["start-case", "pascal-case", "upper-case"]],
    "subject-max-length": [2, "always", 72],
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "docs",
        "style",
        "refactor",
        "perf",
        "test",
        "chore",
        "ci",
        "build",
        "revert",
      ],
    ],
  },
};
