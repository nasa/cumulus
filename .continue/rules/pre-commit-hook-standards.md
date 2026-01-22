---
globs: "**/.pre-commit-config.yaml"
alwaysApply: false
---

When adding or modifying pre-commit hooks, ensure they use existing project configuration files (.eslintrc.js, pyproject.toml, .markdownlint.json, etc.) rather than duplicating rules. Use 'local' hooks with npm/uv scripts to leverage existing tooling and maintain single sources of truth for linting rules.
