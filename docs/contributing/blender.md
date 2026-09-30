# Blender Editing Guide

Read before changing geometry, materials, dimensions, or scene state. For MCP invocation, also read [Development](development.md); for exports, read [Export & Validation](export-validation.md).

## Backup & Scope

Confirm the active `.blend` filepath and exact target objects. Before editing, save and verify a uniquely timestamped copy, e.g. `中航城_修改前_YYYYMMDD_HHMMSS.blend`. Capture unsaved Blender state in the backup; copying the on-disk file alone may miss it. Keep the intended working filepath active and never overwrite earlier backups.

Preserve unrelated edits, assets, and visibility settings. Restore temporary inspection views/settings before saving unless the task requests those changes.

## Naming & Dimensions

Preserve object names, parent hierarchy, and stable control IDs. Follow descriptive patterns such as `区域_客厅` and `主卧_吊顶灯带_控制组`. Record dimensions in meters. Material-only changes should preserve geometry, transforms, slots' intended roles, and existing grooves/openings.

## Materials & Visual Checks

Check both overhead and interior views in material preview or rendered mode. For directional ceilings, confirm that overhead views reveal the room while interior-facing surfaces remain opaque and match the intended wall color. Check emission as well as base color.

A transparent top face can still reveal an opaque bottom face's backside. Inspect backface culling before changing geometry. When a material is shared with unrelated objects, copy it before introducing object-specific settings.

Check daylight blocking, local-light visibility, and device picking separately. Custom properties describe behavior but do not prove that Blender or the consuming application implements it.

Capture before/after evidence for visual changes, verify relevant dimensions or topology, and save the intended file. Clean up only task-created temporary helpers; retain backups and useful evidence.
