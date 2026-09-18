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
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.pointerHandler = null;
    this.pointerDomElement = null;

    root.traverse((object) => {
      if (object.name && !this.objects.has(object.name)) {
        this.objects.set(object.name, object);
      }
    });

    for (const control of [...manifest.animationControls, ...manifest.lightControls]) {
      this.controls.set(control.id, control);
      this.states.set(control.id, control.defaultState);
      if (control.type === "light") {
        this.lightSettings.set(control.id, {
          brightness: control.brightness?.default ?? 1,
          colorTemperatureK: control.colorTemperatureK?.default ?? null,
        });
      }
    }

    // GLB light nodes start visible. Apply manifest defaults before the first render
    // so controls with a default "off" state do not flash on screen.
    for (const control of manifest.lightControls) {
      this.applyLightState(control, this.states.get(control.id));
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
    this.getControl(id);
    return this.states.get(id);
  }

  toggle(id) {
    const control = this.getControl(id);
    const current = this.states.get(id);
    const next = control.type === "light"
      ? (current === "on" ? "off" : "on")
      : (current === "open" ? "closed" : "open");
    return this.setState(id, next);
  }

  setState(id, state) {
    const control = this.getControl(id);
    const allowed = control.states || (control.type === "light" ? ["off", "on"] : ["closed", "open"]);
    if (!allowed.includes(state)) {
      throw new Error(`Invalid state ${state} for ${id}; expected ${allowed.join(", ")}`);
    }

    this.states.set(id, state);
    if (control.type === "light") this.applyLightState(control, state);
    else this.playAnimationState(control, state);
    return state;
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
    return [...names]
      .map((name) => this.objects.get(name))
      .filter((object) => object?.isMesh && object.userData?.threejs_raycastable === true);
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
    this.mixer.update(deltaSeconds);
  }

  dispose() {
    this.unbindPointerEvents();
    for (const actions of this.activeActions.values()) {
      for (const action of actions) action.stop();
    }
    this.mixer.stopAllAction();
  }
}

export default HomeDesignControls;
