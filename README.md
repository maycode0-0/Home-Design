# 中航城 Three.js 交互控制

本目录包含窗帘、门窗、推拉门、灯光以及空调出风、浴霸风暖、地暖特效的 Blender/GLB 模型和 Three.js 控制器。

## 输出文件

- `中航城.blend`
  - 可继续在 Blender 中编辑。
  - 包含 `ThreeJS_交互控制清单`、`ThreeJS_交互控制清单.json` 和 `ThreeJS_控制模板.js` Text 数据块。
- `中航城.glb`
  - Three.js 推荐加载的模型文件。
- `中航城_控制清单.json`
  - 与 GLB 内 `userData.threejs_interaction_manifest` 同步的完整控制清单。
- `ThreeJS_控制模板.js`
  - 可直接复制到 Three.js 项目中的 ES Module 控制器。

## 快速开始

```js
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import HomeDesignControls from "./ThreeJS_控制模板.js";

const loader = new GLTFLoader();
const gltf = await loader.loadAsync("./中航城.glb");
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

## 空调出风与浴霸风暖

5 台空调均支持制冷、加热、送风三种模式，使用相同流线，以颜色区分：制冷蓝色 `#80deff`，加热暖橙色 `#ff963e`，送风绿色 `#55e883`。默认模式为 `cool`（制冷）。每台空调独立记忆模式，切换时复用网格并保持动画进度、强度及开关状态。

2 台浴霸的吹风和加热使用完全相同的向下流线，形状、长度、速度和透明度一致；吹风为蓝色，加热仅改为暖橙色。原有吹风、加热控制 ID 均保留，可分别开关，不影响照明。

所有特效默认关闭，强度范围为 `0..1`，默认 `0.7`。强度 `0` 隐藏特效但保留开关状态。

```js
controls.setEffectMode("effect_ac_living_room_airflow", "cool"); // 制冷：蓝色
controls.setState("effect_ac_living_room_airflow", "on");
controls.setEffectIntensity("effect_ac_living_room_airflow", 0.8);
controls.setEffectMode("effect_ac_living_room_airflow", "heat"); // 加热：暖橙色
controls.setEffectMode("effect_ac_living_room_airflow", "fan"); // 送风：绿色
controls.getEffectMode("effect_ac_living_room_airflow"); // "fan"

controls.setState("effect_primary_bathroom_fan", "on");
controls.setState("effect_primary_bathroom_heat", "on");
controls.setEffectIntensity("effect_primary_bathroom_heat", 0.6);
controls.setState("light_primary_bathroom_heater", "off"); // 照明独立

controls.toggle("effect_primary_bathroom_heat");
controls.setState("effect_ac_living_room_airflow", "off");
// 每帧继续调用 controls.update(deltaSeconds)，参数单位为秒。
// 卸载场景时 controls.dispose() 释放特效网格、材质和交互监听。
```

| 设备 | 出风 / 吹风 ID | 加热 ID |
| --- | --- | --- |
| 主卧空调 | `effect_ac_primary_bedroom_airflow` | — |
| 次卧空调 | `effect_ac_secondary_bedroom_airflow` | — |
| 书房空调 | `effect_ac_study_airflow` | — |
| 客厅空调 | `effect_ac_living_room_airflow` | — |
| 餐厅空调 | `effect_ac_dining_room_airflow` | — |
| 主卫浴霸 | `effect_primary_bathroom_fan` | `effect_primary_bathroom_heat` |
| 次卫浴霸 | `effect_secondary_bathroom_fan` | `effect_secondary_bathroom_heat` |

点击空调切换出风；点击浴霸仍切换照明，吹风和加热通过上述 API 分别控制。特效网格不参与点击检测。

空调模式与开关独立：关闭时调用 `setEffectMode` 只记忆模式，重新开启时应用对应颜色。模式配置位于该控制项的 `modes` / `defaultMode`，只接受 `cool`、`heat`、`fan`；示例页面选择空调后显示模式下拉框。

## 地暖

地暖分为以下四路，开关和强度分别控制。客厅组包含厨房、餐厅、客厅、过道、连接处及地台造型周围的地砖。主卫、次卫不供暖；地台仅排除【地台】实体造型，不再排除整个【区域_地台】。地台右侧红框所示的外伸地砖单独排除，不供暖。默认关闭，强度范围 `0..1`，默认 `0.7`。

| 分区 | 控制 ID | 覆盖面积 |
| --- | --- | --- |
| 主卧 | `effect_floor_heating_primary_bedroom` | 约 24.95 平方米 |
| 次卧 | `effect_floor_heating_secondary_bedroom` | 约 12.25 平方米 |
| 书房 | `effect_floor_heating_study` | 约 8.48 平方米 |
| 客厅（厨房、餐厅、客厅、过道、地台周边地砖） | `effect_floor_heating_living_room` | 约 70.13 平方米 |

```js
controls.setState("effect_floor_heating_primary_bedroom", "on");
controls.setEffectIntensity("effect_floor_heating_primary_bedroom", 0.8);
controls.setState("effect_floor_heating_study", "off"); // 不影响其他分区
controls.setState("effect_floor_heating_living_room", "on");

// 原 ID 保留为四分区总控；强度广播不改变各分区的开关状态。
controls.setState("effect_floor_heating_tiles", "on"); // 四区全部开启
controls.setEffectIntensity("effect_floor_heating_tiles", 0.6);
controls.toggle("effect_floor_heating_tiles"); // 任一区开启时，关闭全部；全关时，开启全部
// 每帧调用 controls.update(clock.getDelta())；强度 0 隐藏特效但保留开关状态。
```

清单版本为 `7`。四个分区位于 `effectControls`，`effect` 为 `floor_heating`；`zone.regions` 记录房间归属。`surface.excludedObjects` 记录主卫、次卫和地台实体；`surface.excludedPatches` 记录地台右侧不供暖地砖的轮廓。原 ID `effect_floor_heating_tiles` 位于 `effectGroups`，类型为 `effect_group`，向 `members` 中的四个分区广播控制，不额外生成地暖网格。总控 `getState()` 在任一区开启时返回 `on`，全部关闭时返回 `off`。

`surface.positions` 是地砖局部 glTF 坐标系中的裁剪三角面。四区无重叠，总覆盖约 **115.82 平方米**，比原顶面高 12 毫米以避免闪烁。地砖移动和旋转时特效随之移动；修改地砖、房间或排除区域的轮廓后，需重新划分裁剪面。每个分区使用一个 ShaderMaterial 绘制调用，家具仍可遮挡它，不改变地砖原材质，也不接管地面点击。

示例页面可选择具体地暖分区调节强度；“地暖 · 全部分区”提供四个独立开关，其强度滑块同时调节四区。

特效参数位于清单的 `effectControls`。Blender 和 GLB 保存风口锚点及控制元数据；动态冷暖风流线和地暖热纹由本控制器在 Three.js 中生成，Blender 视口和只加载 GLB 的查看器不会播放这些特效。加载时必须同时使用新版控制器，并逐帧调用 `update`。每路特效仅使用一个绘制调用，无需纹理或后处理；关闭后停止更新，重新开启复用资源。锚点 glTF 局部 `+Y` 为出风方向，跟随设备移动和旋转。

交互示例：[examples/device-effects.html](examples/device-effects.html)。在本目录运行 `python -m http.server 8000 --bind 127.0.0.1`，打开 `http://127.0.0.1:8000/examples/device-effects.html`。示例通过 CDN 加载 Three.js 0.180.0，需要网络；可切换设备、视角、照明、特效开关与强度。

## 控制数量

- 5 组窗帘
- 6 扇门
- 9 组窗户
- 2 组推拉门
- 44 组灯光开关
- 30 组射灯/灯带支持色温和亮度调节
- 4 组吊灯支持开关控制
- 13 路特效控制（5 路空调出风、2 路浴霸吹风、2 路浴霸加热、4 路地暖分区）
- 1 路地暖总控（兼容原 `effect_floor_heating_tiles` ID）

导出模型共包含 66 个动画片段。可通过 `controls.getRaycastTargets()` 获取可交互网格；多材质设备由 GLTFLoader 创建为 Group 时，控制器会返回其子网格。

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
