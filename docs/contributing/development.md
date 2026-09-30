# Development Guide

Read for repository navigation, script changes, or Blender MCP operations.

## Project Layout

This repository contains Blender assets and Three.js integration, not a standalone web application.

- `中航城.blend`: primary editable scene; `中航城.glb`: exported runtime asset.
- `中航城_控制清单.json`: interaction manifest for doors, windows, curtains, and lights.
- `ThreeJS_控制模板.js`: ES-module controller; the consuming application supplies `three`.
- `scripts/inspect-glb.mjs`: dependency-free Node.js inspector.
- `scripts/blender_mcp_client.py`: reusable client for Blender inspection and script execution through MCP.
- Root-level `.blend1`, timestamped `.blend` copies, and PNGs: backups or visual evidence. Preserve unrelated assets.

The README includes historical long asset filenames. Confirm the actual target instead of copying an outdated filename.

## Commands

Run from the repository root:

```sh
node scripts/inspect-glb.mjs "中航城.glb"
node --check scripts/inspect-glb.mjs
python scripts/blender_mcp_client.py get_scene_info
```

The first command reports hierarchy, bounds, and curtain animation channels; the second checks inspector syntax. The Python command reports the current Blender scene and requires an open Blender session with MCP listening on `127.0.0.1:9876`. To run an existing script, use `execute_code --script <path.py>`. Code using `bpy` executes inside Blender, not ordinary system Python. Review modification scripts and back up their targets before execution. One-off scripts and their older versions are archived under `backups/` after cleanup.

No package manifest, build system, development server, automated test runner, formatter, or linter is configured. There is no established coverage threshold or test naming convention. Use checks appropriate to the change and the [validation guide](export-validation.md).

## Code Style & Search

- Follow `.gitattributes`: UTF-8/LF text; Blender/glTF assets remain binary.
- Use two-space JavaScript indentation. Match existing punctuation: double quotes and semicolons in the controller; single quotes without semicolons in the inspector.
- Use four-space indentation for new Python code. Avoid unrelated formatting changes.
- Preserve Chinese object names and stable `threejs_control_id` values.
- If `.codegraph/` exists, use CodeGraph before code searches or reads: `codegraph explore "<question>"` or `codegraph node <symbol-or-file>`. Otherwise skip indexing and use `rg` / `rg --files`.
