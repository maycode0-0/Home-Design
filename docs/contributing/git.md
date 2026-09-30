# Commit & Pull Request Guide

Read before staging, committing, or preparing a pull request.

## Commits

History commonly uses `fix:`, `feat:`, and `chore:` with concise Chinese descriptions, for example `fix: 修复吊顶顶部透视`. Follow this convention and describe the resulting behavior.

Review the worktree and stage explicit paths. Exclude temporary helpers, timestamped backups, and unrelated changes unless requested. Never remove existing backups merely to clean the worktree. Treat `.blend`, `.blend1`, and glTF binary assets according to `.gitattributes`.

## Pull Requests

Include:

- Affected objects/files and changed dimensions or behavior.
- Validation commands, results, and any checks not performed.
- Export status: whether the GLB, manifest, and embedded data were updated together.
- Linked issues when relevant and before/after screenshots for visual changes.

Keep source-scene changes distinct from export results so reviewers can identify stale runtime assets. Consult [Export & Validation](export-validation.md) for required export checks.
