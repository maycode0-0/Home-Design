# 中航城 Three.js 交互控制

本目录包含已经配置好窗帘、门窗、推拉门和灯光控制元数据的 Blender/GLB 模型。

## 输出文件

- `中航城_optimized_灯带_吊顶_凹槽灯带_拓扑修复_窗帘_客厅纱帘_窗帘盒_全屋窗帘盒_地台黑边修复_窗帘柔化_窗帘动画_ThreeJS交互.blend`
  - 可继续在 Blender 中编辑。
  - 包含 `ThreeJS_交互控制清单`、`ThreeJS_交互控制清单.json` 和 `ThreeJS_控制模板.js` Text 数据块。
- `中航城_optimized_灯带_吊顶_凹槽灯带_拓扑修复_窗帘_客厅纱帘_窗帘盒_全屋窗帘盒_地台黑边修复_窗帘柔化_窗帘动画_ThreeJS交互.glb`
  - Three.js 推荐加载的模型文件。
- `中航城_optimized_灯带_吊顶_凹槽灯带_拓扑修复_窗帘_客厅纱帘_窗帘盒_全屋窗帘盒_地台黑边修复_窗帘柔化_窗帘动画_ThreeJS交互_控制清单.json`
  - 与 GLB 内 `userData.threejs_interaction_manifest` 同步的完整控制清单。
- `ThreeJS_控制模板.js`
  - 可直接复制到 Three.js 项目中的 ES Module 控制器。

## 快速开始

```js
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import HomeDesignControls from "./ThreeJS_控制模板.js";

const loader = new GLTFLoader();
const gltf = await loader.loadAsync("./中航城_optimized_灯带_吊顶_凹槽灯带_拓扑修复_窗帘_客厅纱帘_窗帘盒_全屋窗帘盒_地台黑边修复_窗帘柔化_窗帘动画_ThreeJS交互.glb");
scene.add(gltf.scene);

const controls = HomeDesignControls.fromGLTF(gltf);
controls.bindPointerEvents(renderer.domElement, camera);
const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);
  controls.update(clock.getDelta());
  renderer.render(scene, camera);
}
animate();
```

## 控制接口

动画和灯光都使用稳定的 `threejs_control_id`。完整 ID、目标对象和动画片段请以控制清单 JSON 为准。

```js
controls.toggle("curtain_000");
controls.setState("door_000", "open");
controls.setState("window_017", "closed");

// 射灯和灯带支持 2700K-6500K。
controls.setColorTemperature("light_living_room_ceiling_strip", 4000);

// 亮度使用 0.03-1.0 的归一化值，对应 3%-100%。
controls.setBrightness("light_living_room_ceiling_strip", 0.6);
```

## 控制数量

- 5 组窗帘
- 6 扇门
- 9 组窗户
- 2 组推拉门
- 34 组灯光开关
- 30 组射灯/灯带支持色温和亮度调节
- 4 组吊灯支持开关控制

窗帘、门窗和推拉门共包含 64 个 Open/Close 动画片段。所有可交互网格都带有 `threejs_raycastable=true`，可通过 `controls.getRaycastTargets()` 获取。

## 灯光参数

射灯和灯带的清单参数如下：

- 色温范围：`2700K-6500K`
- 默认色温：`3500K`
- 亮度范围：`3%-100%`
- 默认亮度：`100%`
- 射灯参考参数：6W、约 350lm、Ra >= 90、32 度光束角、30 度旋转范围

模板会在第一次控制时缓存 Three.js 中的原始 `Light.intensity` 和 `emissiveIntensity`，调节亮度时按比例缩放，关闭后可以恢复原始值。

## 清单发现方式

GLB 场景中有一个名为 `ThreeJS_交互控制清单` 的 Empty。其属性如下：

- `userData.threejs_interaction_manifest`
- `userData.threejs_manifest_version`
- `userData.threejs_control_count`

应用也可以遍历场景，通过节点的 `userData.threejs_control_id` 和 `userData.threejs_control_type` 建立对象索引。

## 重新导出 GLB

glTF 不支持 Blender 的 `AREA` 灯。当前 GLB 导出时会将 28 个 AREA 灯临时映射为同方向 SPOT 灯，导出完成后恢复 Blender 中的 AREA 灯，不改变 `.blend` 的原始灯型。

如果需要在 Blender 中重新导出，请运行 Blender Text 数据块 `ThreeJS_导出GLB.py`。

> 不要用任何会展平层级（Flatten Object Hierarchy）或不导出动画的通用导出入口（包括 MCP 的 `export_scene` 工具）。展平会删掉 `*_动画控制` Empty，把它的缩放烘进网格节点，缩放轴心随之跑到网格节点自身原点上，窗帘开合就会往中间收、方向反转甚至穿墙。

导出选项必须保持：

- Animations：开启
- Animation Mode：`ACTIONS`
- NLA Strips：开启
- Punctual Lights：开启
- Custom Properties / Extras：开启
