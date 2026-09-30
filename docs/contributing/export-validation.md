# Export & Validation Guide

Read before GLB export, Three.js interaction changes, or scene validation. Use [Development](development.md) for inspection commands and [Blender](blender.md) when editing the source scene.

## Export Requirements

Back up existing output files before replacing them. Run the scene's `ThreeJS_导出GLB.py` Blender Text block. Preserve:

- Object hierarchy, especially `*_动画控制` Empty parents.
- Animations enabled with Animation Mode `ACTIONS` and NLA Strips enabled.
- Punctual Lights and Custom Properties / Extras enabled.

Never use an export path that flattens hierarchy or omits animations, including a generic MCP `export_scene` path with those behaviors. Flattening control parents can change curtain pivots, reverse movement, or cause wall intersections.

glTF does not support Blender AREA lights. The documented exporter temporarily maps them to SPOT lights; confirm original AREA types are restored afterward.

Synchronize the GLB, external control manifest, and embedded control data. Preserve `threejs_control_id` and `threejs_interaction_manifest`. Saving a `.blend` does not update its `.glb` automatically; report which files were updated.

## Validation

No automated test suite or coverage requirement is configured. Validate affected behavior in Blender and, after exporting, in the consuming Three.js application:

- Inspect hierarchy, bounds, and curtain animation channels with `node scripts/inspect-glb.mjs "中航城.glb"`.
- Exercise open/close endpoints for affected doors, windows, sliding doors, and curtains. Check pivots and intersections.
- Verify device picking through intended targets, plus light toggles, brightness, and color temperature where applicable.
- Compare overhead and interior material appearance. Check transparency, backfaces, sunlight blocking, and visible local lighting independently.

Metadata and successful export alone are insufficient evidence. Include relevant screenshots and inspection results. If runtime validation is unavailable, state that limitation rather than claiming it passed.
