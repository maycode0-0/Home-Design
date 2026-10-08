import * as THREE from "three";

/**
 * Runtime controller for the exported Home-Design GLB.
 *
 * Usage:
 *   const controls = HomeDesignControls.fromGLTF(gltf);
 *   controls.bindPointerEvents(renderer.domElement, camera);
 *   controls.update(clock.getDelta());
 *   controls.toggle("light_living_room_ceiling_strip");
 *   controls.setColorTemperature("light_living_room_ceiling_strip", 4000);
 *   controls.setBrightness("light_living_room_ceiling_strip", 0.6);
 */

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Approximation suitable for UI-controlled CCT values in the 2700K-6500K range.
function colorTemperatureToRGB(kelvin) {
  const temperature = clamp(kelvin, 1000, 40000) / 100;
  let red;
  let green;
  let blue;

  if (temperature <= 66) {
    red = 255;
    green = 99.4708025861 * Math.log(temperature) - 161.1195681661;
    blue = temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;
  } else {
    red = 329.698727446 * (temperature - 60) ** -0.1332047592;
    green = 288.1221695283 * (temperature - 60) ** -0.0755148492;
    blue = 255;
  }

  return [red, green, blue].map((channel) => clamp(channel / 255, 0, 1));
}

// One draw call per effect, with no textures or postprocessing dependency.
// Emitters use local +Y for travel, X for width and Z for outlet depth (glTF axes).
class DeviceEffect {
  constructor(anchor, control) {
    this.config = control.visual;
    this.time = 0;
    this.count = 24;
    this.segments = 10;
    const vertexCount = this.count * (this.segments + 1) * 4;
    this.positions = new Float32Array(vertexCount * 3);
    this.colors = new Float32Array(vertexCount * 3);
    const indices = [];
    for (let i = 0; i < this.count; i += 1) {
      for (let j = 0; j < this.segments; j += 1) {
        const a = (i * (this.segments + 1) + j) * 4;
        for (const side of [0, 2]) {
          indices.push(a + side, a + side + 1, a + side + 4,
            a + side + 1, a + side + 5, a + side + 4);
        }
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute("color", new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setIndex(indices);
    const { width, depth, length, spread } = this.config;
    this.geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(0, length / 2, 0), width + depth + length + spread,
    );
    this.material = new THREE.MeshBasicMaterial({
      color: this.config.color,
      vertexColors: true,
      transparent: true,
      opacity: this.config.opacity,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = `${control.id}__runtime_effect`;
    this.mesh.userData.threejs_raycastable = false;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
    anchor.add(this.mesh);
  }

  update(deltaSeconds, intensity) {
    if (!this.mesh.visible || intensity <= 0) return;
    const { width, depth, length, spread, speed } = this.config;
    // Wrap the phase to retain precision in long-running dashboards.
    this.time = (this.time + deltaSeconds * speed * (0.35 + intensity * 0.65) / length) % 1;
    this.material.opacity = this.config.opacity * intensity;
    for (let i = 0; i < this.count; i += 1) {
      const phase = (this.time + i / this.count) % 1;
      const seed = i * 2.3999632297;
      const laneX = ((i * 0.61803398875) % 1 - 0.5) * width;
      const laneZ = ((i * 0.38196601125) % 1 - 0.5) * depth;
      for (let j = 0; j <= this.segments; j += 1) {
        const t = j / this.segments;
        const p = clamp(phase - t * 0.22, 0, 1);
        const fade = Math.sin(p * Math.PI) * Math.sin(t * Math.PI);
        const x = laneX * (1 + p * spread) + Math.sin(seed + p * 5) * 0.035 * p;
        const z = laneZ * (1 + p * spread) + Math.cos(seed + p * 4) * 0.022 * p;
        const radius = 0.005 * Math.sin(t * Math.PI);
        const y = p * length;
        const offset = (i * (this.segments + 1) + j) * 12;
        // Crossed ribbons keep the streams visible from overhead and interior views.
        for (let k = 0; k < 4; k += 1) {
          const v = offset + k * 3;
          const sign = k % 2 === 0 ? -1 : 1;
          this.positions[v] = x + (k < 2 ? sign * radius : 0);
          this.positions[v + 1] = y;
          this.positions[v + 2] = z + (k >= 2 ? sign * radius : 0);
          this.colors[v] = fade;
          this.colors[v + 1] = fade;
          this.colors[v + 2] = fade;
        }
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

// The authored surface is clipped to the tile footprint, including room cutouts.
// Coordinates are local to the tile object in glTF axes, so the effect follows it.
class FloorHeatingEffect {
  constructor(anchor, control) {
    const { surface, visual } = control;
    if (!surface?.positions?.length || surface.positions.length % 9 !== 0
      || !surface.positions.every(Number.isFinite)) {
      throw new Error(`Invalid floor heating surface for ${control.id}`);
    }
    this.time = 0;
    this.config = visual;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute("position", new THREE.Float32BufferAttribute(surface.positions, 3));
    this.geometry.computeBoundingSphere();
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        strength: { value: 0 },
        opacity: { value: visual.opacity },
        spacing: { value: visual.spacing },
        warmColor: { value: new THREE.Color(visual.color) },
        hotColor: { value: new THREE.Color(visual.highlightColor) },
      },
      vertexShader: `
        varying vec2 floorPosition;
        void main() {
          floorPosition = position.xz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float strength;
        uniform float opacity;
        uniform float spacing;
        uniform vec3 warmColor;
        uniform vec3 hotColor;
        varying vec2 floorPosition;
        void main() {
          vec2 p = floorPosition;
          float wave = sin(p.x * 1.7) * spacing * 0.16;
          float lane = (p.y + wave) / spacing;
          float distanceToLine = abs(fract(lane + 0.5) - 0.5) * spacing;
          float pipe = 1.0 - smoothstep(0.012, 0.040, distanceToLine);
          float glow = 1.0 - smoothstep(0.025, spacing * 0.42, distanceToLine);
          float direction = mod(floor(lane + 0.5), 2.0) * 2.0 - 1.0;
          float flow = pow(0.5 + 0.5 * sin(p.x * 3.8 * direction - time * 3.0), 5.0);
          float pulse = 0.5 + 0.5 * sin(p.x * 0.75 + p.y * 0.6 - time);
          float alpha = (0.08 + 0.07 * pulse + glow * 0.14
            + pipe * (0.32 + flow * 0.42)) * opacity * strength;
          gl_FragColor = vec4(mix(warmColor, hotColor, pipe * flow * 0.8), alpha);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = `${control.id}__runtime_effect`;
    this.mesh.userData.threejs_raycastable = false;
    this.mesh.raycast = () => {};
    this.mesh.visible = false;
    anchor.add(this.mesh);
  }

  update(deltaSeconds, intensity) {
    if (!this.mesh.visible || intensity <= 0) return;
    this.time = (this.time + deltaSeconds * this.config.speed * (0.35 + intensity * 0.65)) % (Math.PI * 2);
    this.material.uniforms.time.value = this.time;
    this.material.uniforms.strength.value = intensity;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}

export class HomeDesignControls {
  constructor({ root, animations = [], manifest }) {
    if (!root) throw new Error("HomeDesignControls requires a GLTF scene root");
    if (!manifest?.animationControls || !manifest?.lightControls) {
      throw new Error("Invalid threejs interaction manifest");
    }

    this.root = root;
    this.manifest = manifest;
    this.mixer = new THREE.AnimationMixer(root);
    this.clips = new Map(animations.map((clip) => [clip.name, clip]));
    this.objects = new Map();
    this.controls = new Map();
    this.states = new Map();
    this.activeActions = new Map();
    this.lightCache = new Map();
    this.emissiveCache = new Map();
    this.lightSettings = new Map();
    this.effectSettings = new Map();
    this.effects = new Map();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerHandler = null;
    this.pointerDomElement = null;

    root.traverse((object) => {
      if (object.name && !this.objects.has(object.name)) {
        this.objects.set(object.name, object);
      }
    });

    for (const control of [...manifest.animationControls, ...manifest.lightControls,
      ...(manifest.effectControls || []), ...(manifest.effectGroups || [])]) {
      this.controls.set(control.id, control);
      this.states.set(control.id, control.defaultState);
      if (control.type === "light") {
        this.lightSettings.set(control.id, {
          brightness: control.brightness?.default ?? 1,
          colorTemperatureK: control.colorTemperatureK?.default ?? null,
        });
      }
      if (control.type === "effect") {
        if (control.modes && !Object.hasOwn(control.modes, control.defaultMode)) {
          throw new Error(`Invalid default effect mode for ${control.id}`);
        }
        this.effectSettings.set(control.id, {
          intensity: control.intensity?.default ?? 0.7,
          mode: control.defaultMode ?? null,
        });
      }
    }

    for (const group of manifest.effectGroups || []) {
      if (!group.members?.length || group.members.some((id) => this.controls.get(id)?.type !== "effect")) {
        throw new Error(`Invalid effect group members for ${group.id}`);
      }
    }

    // GLB light nodes start visible. Apply manifest defaults before the first render
    // so controls with a default "off" state do not flash on screen.
    for (const control of manifest.lightControls) {
      this.applyLightState(control, this.states.get(control.id));
    }
    for (const control of manifest.effectControls || []) {
      this.applyEffectState(control, this.states.get(control.id));
    }
  }

  static fromGLTF(gltf) {
    const root = gltf.scene || gltf.scenes?.[0];
    if (!root) throw new Error("GLTF has no scene root");

    let manifestNode = null;
    root.traverse((object) => {
      if (object.name === "ThreeJS_交互控制清单") manifestNode = object;
    });
    const raw = manifestNode?.userData?.threejs_interaction_manifest;
    const manifest = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!manifest) {
      throw new Error("ThreeJS_交互控制清单 extras not found in GLTF");
    }
    return new HomeDesignControls({
      root,
      animations: gltf.animations || [],
      manifest,
    });
  }

  getControl(id) {
    const control = this.controls.get(id);
    if (!control) throw new Error(`Unknown Three.js control: ${id}`);
    return control;
  }

  getState(id) {
    const control = this.getControl(id);
    // A partially enabled group is on; toggling it switches every member off.
    if (control.type === "effect_group") {
      return control.members.some((member) => this.getState(member) === "on") ? "on" : "off";
    }
    return this.states.get(id);
  }

  toggle(id) {
    const control = this.getControl(id);
    const current = this.getState(id);
    const next = ["light", "effect", "effect_group"].includes(control.type)
      ? (current === "on" ? "off" : "on")
      : (current === "open" ? "closed" : "open");
    return this.setState(id, next);
  }

  setState(id, state) {
    const control = this.getControl(id);
    const allowed = control.states || (["light", "effect", "effect_group"].includes(control.type) ? ["off", "on"] : ["closed", "open"]);
    if (!allowed.includes(state)) {
      throw new Error(`Invalid state ${state} for ${id}; expected ${allowed.join(", ")}`);
    }

    if (control.type === "effect_group") {
      for (const member of control.members) this.setState(member, state);
    } else if (control.type === "light") this.applyLightState(control, state);
    else if (control.type === "effect") this.applyEffectState(control, state);
    else this.playAnimationState(control, state);
    this.states.set(id, state);
    return state;
  }

  setEffectIntensity(id, value) {
    const control = this.getControl(id);
    if (!["effect", "effect_group"].includes(control.type)) throw new Error(`Effect intensity is not supported by ${id}`);
    if (!Number.isFinite(value)) throw new Error("Effect intensity must be a finite number");
    const range = control.intensity || { min: 0, max: 1 };
    if (control.type === "effect_group") {
      const intensity = clamp(value, range.min, range.max);
      for (const member of control.members) this.setEffectIntensity(member, intensity);
      return intensity;
    }
    const settings = this.effectSettings.get(id);
    settings.intensity = clamp(value, range.min, range.max);
    this.applyEffectState(control, this.states.get(id));
    return settings.intensity;
  }

  getEffectMode(id) {
    const control = this.getControl(id);
    if (control.type !== "effect" || !control.modes) {
      throw new Error(`Effect mode is not supported by ${id}`);
    }
    return this.effectSettings.get(id).mode;
  }

  setEffectMode(id, mode) {
    const control = this.getControl(id);
    this.getEffectMode(id);
    if (typeof mode !== "string" || !Object.hasOwn(control.modes, mode)) {
      throw new Error(`Invalid effect mode ${mode} for ${id}; expected ${Object.keys(control.modes).join(", ")}`);
    }
    this.effectSettings.get(id).mode = mode;
    this.applyEffectState(control, this.states.get(id));
    return mode;
  }

  applyEffectState(control, state) {
    const { intensity, mode } = this.effectSettings.get(control.id);
    const visible = state === "on" && intensity > 0;
    let effect = this.effects.get(control.id);
    if (!effect && visible) {
      const anchor = this.objects.get(control.emitter);
      if (!anchor) throw new Error(`Missing effect emitter ${control.emitter} for ${control.id}`);
      effect = control.effect === "floor_heating"
        ? new FloorHeatingEffect(anchor, control)
        : new DeviceEffect(anchor, control);
      this.effects.set(control.id, effect);
    }
    if (effect) {
      if (control.modes) effect.material.color.set(control.modes[mode].color);
      effect.mesh.visible = visible;
      effect.update(0, intensity);
    }
  }

  setBrightness(id, value) {
    const control = this.getControl(id);
    if (control.type !== "light" || !control.capabilities?.includes("brightness")) {
      throw new Error(`Brightness is not supported by ${id}`);
    }
    const range = control.brightness;
    const settings = this.lightSettings.get(id);
    settings.brightness = clamp(value, range.min, range.max);
    this.applyLightState(control, this.states.get(id));
    return settings.brightness;
  }

  setColorTemperature(id, kelvin) {
    const control = this.getControl(id);
    if (control.type !== "light" || !control.capabilities?.includes("color_temperature")) {
      throw new Error(`Color temperature is not supported by ${id}`);
    }
    const range = control.colorTemperatureK;
    const settings = this.lightSettings.get(id);
    settings.colorTemperatureK = clamp(kelvin, range.min, range.max);
    const [red, green, blue] = colorTemperatureToRGB(settings.colorTemperatureK);

    for (const entry of control.lights || []) {
      const object = this.objects.get(entry.object);
      if (!object?.isLight) continue;
      this.cacheLight(object);
      object.color.setRGB(red, green, blue);
    }
    for (const entry of control.emissiveTargets || []) {
      const mesh = this.objects.get(entry.object);
      if (!mesh) continue;
      for (const materialEntry of entry.materials || []) {
        const material = this.findMaterial(mesh, materialEntry.material, materialEntry.slot);
        if (!material) continue;
        this.cacheMaterial(material);
        if (material.emissive?.setRGB) material.emissive.setRGB(red, green, blue);
        else if (material.color?.setRGB) material.color.setRGB(red, green, blue);
        material.needsUpdate = true;
      }
    }
    return settings.colorTemperatureK;
  }

  playAnimationState(control, state) {
    // Older manifests use `close` while their public state is `closed`.
    const clipNames = control.clips?.[state]
      || (state === "closed" ? control.clips?.close : undefined);
    if (!clipNames) throw new Error(`Animation state ${state} is not defined for ${control.id}`);

    const previous = this.activeActions.get(control.id) || new Set();
    const next = new Set();

    for (const clipName of clipNames) {
      const clip = this.clips.get(clipName);
      if (!clip) {
        console.warn(`[HomeDesignControls] Missing animation clip: ${clipName}`);
        continue;
      }
      const action = this.mixer.clipAction(clip, this.root);
      action.reset();
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      next.add(action);
    }

    // Bind the incoming actions before stopping the outgoing ones. AnimationAction.stop()
    // drops each property binding's useCount, and at zero the mixer calls
    // PropertyMixer.restoreOriginalState(), writing back the pose captured when that binding
    // was first activated - the authored closed pose. Stopping first therefore snapped the
    // object shut before the closing clip had a chance to play, while opening looked fine
    // because the restored pose and the object's current pose were both "closed".
    // Playing first keeps useCount above zero across the handover, so no pose is restored.
    for (const action of previous) {
      if (!next.has(action)) action.stop();
    }

    this.activeActions.set(control.id, next);
  }

  applyLightState(control, state) {
    const on = state === "on";
    const settings = this.lightSettings.get(control.id) || { brightness: 1 };

    for (const entry of control.lights || []) {
      const object = this.objects.get(entry.object);
      if (!object?.isLight) continue;
      const cached = this.cacheLight(object);
      object.visible = on ? cached.visible : false;
      object.intensity = on ? cached.intensity * settings.brightness : 0;
    }

    for (const entry of control.emissiveTargets || []) {
      const mesh = this.objects.get(entry.object);
      if (!mesh) continue;
      for (const materialEntry of entry.materials || []) {
        const material = this.findMaterial(mesh, materialEntry.material, materialEntry.slot);
        if (!material) continue;
        const cached = this.cacheMaterial(material);
        if (typeof material.emissiveIntensity === "number") {
          material.emissiveIntensity = on ? cached.intensity * settings.brightness : 0;
        }
        material.needsUpdate = true;
      }
    }
  }

  cacheLight(object) {
    if (!this.lightCache.has(object.uuid)) {
      this.lightCache.set(object.uuid, {
        intensity: object.intensity,
        visible: object.visible,
        color: object.color?.clone?.(),
      });
    }
    return this.lightCache.get(object.uuid);
  }

  cacheMaterial(material) {
    if (!this.emissiveCache.has(material.uuid)) {
      this.emissiveCache.set(material.uuid, {
        intensity: typeof material.emissiveIntensity === "number" ? material.emissiveIntensity : 1,
        color: material.emissive?.clone?.() || material.color?.clone?.(),
      });
    }
    return this.emissiveCache.get(material.uuid);
  }

  findMaterial(mesh, name, slot) {
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    return materials.find((material) => material?.name === name) || materials[slot] || null;
  }

  getRaycastTargets() {
    const names = new Set();
    for (const control of this.controls.values()) {
      for (const name of control.clickTargets || []) names.add(name);
    }
    const targets = new Set();
    for (const name of names) {
      const object = this.objects.get(name);
      if (object?.userData?.threejs_raycastable !== true) continue;
      // GLTFLoader represents a Blender mesh with several materials as a Group.
      object.traverse((child) => {
        if (child.isMesh && child.userData?.threejs_raycastable !== false) targets.add(child);
      });
    }
    return [...targets];
  }

  controlIdFromObject(object) {
    let current = object;
    while (current) {
      const id = current.userData?.threejs_control_id;
      if (id && this.controls.has(id)) return id;
      current = current.parent;
    }
    return null;
  }

  handleIntersection(intersection) {
    const id = this.controlIdFromObject(intersection?.object);
    return id ? this.toggle(id) : null;
  }

  bindPointerEvents(domElement, camera) {
    this.unbindPointerEvents();
    const targets = this.getRaycastTargets();
    this.pointerHandler = (event) => {
      const rect = domElement.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, camera);
      const hit = this.raycaster.intersectObjects(targets, true)[0];
      if (hit) this.handleIntersection(hit);
    };
    this.pointerDomElement = domElement;
    domElement.addEventListener("pointerup", this.pointerHandler);
    return () => this.unbindPointerEvents();
  }

  unbindPointerEvents() {
    if (this.pointerHandler && this.pointerDomElement) {
      this.pointerDomElement.removeEventListener("pointerup", this.pointerHandler);
    }
    this.pointerHandler = null;
    this.pointerDomElement = null;
  }

  update(deltaSeconds) {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
    this.mixer.update(deltaSeconds);
    for (const [id, effect] of this.effects) {
      effect.update(deltaSeconds, this.effectSettings.get(id).intensity);
    }
  }

  dispose() {
    this.unbindPointerEvents();
    for (const actions of this.activeActions.values()) {
      for (const action of actions) action.stop();
    }
    this.mixer.stopAllAction();
    for (const effect of this.effects.values()) effect.dispose();
    this.effects.clear();
    this.mixer.uncacheRoot(this.root);
  }
}

export default HomeDesignControls;
