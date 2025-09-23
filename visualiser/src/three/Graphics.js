import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { TransformControls } from "three/examples/jsm/controls/TransformControls";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer";
import Stats from "three/examples/jsm/libs/stats.module";
import React from "react";
import { DeviceSelectEvent, FloorSelectEvent, LoadEvent } from "./events";
import { apiFetch } from "../api";

let LAYERS = [
  "floors.glb",
  "exterior-walls.glb",
  "interior-walls.glb",
  "windows.glb",
  "stairs.glb",
  "decoration.glb",
  "glass.glb",
  "egg.glb",
];

// Fancy circle-like device: small torus ring
const DEVICE_GEOM = new THREE.TorusGeometry(1.2, 0.2, 12, 24);
const DEVICE_COLOR = 0xff5555;
const DEVICE_HOVER_COLOR = 0x00aaff;
const DEVICE_SELECTED_COLOR = 0x00ffaa;
const DEVICE_COLOR_HEX = '#ff5555';
const DEVICE_HOVER_COLOR_HEX = '#00aaff';
const DEVICE_SELECTED_COLOR_HEX = '#00ffaa';

// Inline SVGs as textures for sprites (white base; tint via material.color)
const DEVICE_ICON_SVG = `
<svg xmlns='http://www.w3.org/2000/svg' width='48' height='56' viewBox='0 0 24 28'>
  <g fill='none' stroke='#ffffff' stroke-width='2' stroke-linecap='round'>
    <path d='M4 8a8 8 0 0 1 16 0'/>
    <path d='M7 10a5 5 0 0 1 10 0'/>
  </g>
  <rect x='6.5' y='12' width='11' height='13' rx='3' ry='3' fill='#ffffff'/>
  <circle cx='12' cy='19' r='1.5' fill='#ffffff'/>
  <rect x='0' y='0' width='24' height='28' fill='transparent'/>
  
</svg>`;
// Closed and Open lock icons to indicate pinned/unpinned clearly
const LOCK_CLOSED_SVG = `
<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24'>
  <rect x='0' y='0' width='24' height='24' fill='transparent'/>
  <path d='M7 10V8a5 5 0 0 1 10 0v2' fill='none' stroke='#ffffff' stroke-width='2' stroke-linecap='round'/>
  <rect x='5' y='10' width='14' height='10' rx='2' fill='#ffffff'/>
  <circle cx='12' cy='15' r='1.6' fill='#0b0b0b'/>
 </svg>`;
const LOCK_OPEN_SVG = `
<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28' viewBox='0 0 24 24'>
  <rect x='0' y='0' width='24' height='24' fill='transparent'/>
  <path d='M16 8a4 4 0 0 0-8 0' fill='none' stroke='#ffffff' stroke-width='2' stroke-linecap='round'/>
  <rect x='5' y='10' width='14' height='10' rx='2' fill='#ffffff'/>
  <circle cx='12' cy='15' r='1.6' fill='#0b0b0b'/>
</svg>`;
const svgToDataUrl = (svg) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const DEVICE_ICON_TEX = new THREE.TextureLoader().load(svgToDataUrl(DEVICE_ICON_SVG));
const LOCK_CLOSED_TEX = new THREE.TextureLoader().load(svgToDataUrl(LOCK_CLOSED_SVG));
const LOCK_OPEN_TEX = new THREE.TextureLoader().load(svgToDataUrl(LOCK_OPEN_SVG));
// three@0.137 doesn't expose SRGBColorSpace; use legacy encoding flag for similar effect
DEVICE_ICON_TEX.encoding = THREE.sRGBEncoding;
LOCK_CLOSED_TEX.encoding = THREE.sRGBEncoding;
LOCK_OPEN_TEX.encoding = THREE.sRGBEncoding;

export default class Graphics {
  static instance;
  width = window.innerWidth;
  height = window.innerHeight;
  ref;

  onReize = () => { this.resize(); };
  onAnimate = () => { this.animate(); };
  onPointerMove = (event) => { this.pointerMove(event); };
  onPointerDown = (event) => { this.pointerDown(event); };
  onPointerUp = (event) => { this.pointerUp(event); };
  onDoubleClick = (event) => { this.handleDoubleClick(event); };
  onContextMenu = (event) => { this.handleContextMenu(event); };
  onKeyDown = (event) => { this.handleKeyDown(event); };
  onKeyUp = (event) => { this.handleKeyUp(event); };
  onFloorSelect = (event) => {
    const e = event;
    this.setFloor(e.detail.floor);
  };

  deselectDevice() {
    const prev = this._selectedDevice;
    if (!prev) return;
    // Reset icon color
    if (prev.userData?.deviceIconSprite) prev.userData.deviceIconSprite.material.color.set(DEVICE_COLOR);
    this._selectedDevice = undefined;
    // Detach transform and close HUD
    try { this.transform.detach(); } catch (_) {}
    this.closeSelectionHud();
    // Reset cursor
    this.renderer.domElement.style.cursor = '';
    // Broadcast deselection
    window.dispatchEvent(new DeviceSelectEvent(null));
  }

  camera = new THREE.PerspectiveCamera();
  scene = new THREE.Scene();
  deviceScene = new THREE.Scene();
  renderer = new THREE.WebGLRenderer({ powerPreference: "high-performance" });
  labelRenderer = new CSS2DRenderer();
  rayCaster = new THREE.Raycaster();
  clippingPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);
  clock = new THREE.Clock();
  controls = new OrbitControls(this.camera, this.renderer.domElement);
  stats = Stats();
  pointer = { x: 0, y: 0 };
  _hoveredDevice;
  _selectedDevice;
  _dragging = false; // Manual ground-drag state
  _dragDevice = undefined; // Mesh being dragged manually
  _dragOrig = undefined; // Original position Vector3 copy for transform/manual
  _dragDelta = undefined; // Delta between initial device pos and ground pick point (x/z)
  ground = undefined; // Reference to ground plane mesh
  transform; // TransformControls
  _transformDragging = false; // Whether TransformControls is active
  _ctrlPressed = false; // Track Ctrl key state
  _moveMenu = undefined; // { obj: CSS2DObject, el: HTMLElement, mesh }
  _activeMove = undefined; // 'Y' | 'XZ' when constrained move mode is active
  _unpinnedByMove = false; // If we had to unpin to allow move
  _lockAfterMove = false; // Auto pin after finishing a move
  _saveTimer = undefined; // Timer for throttled save during transform
  _selectionHud = undefined; // { obj: CSS2DObject, el: HTMLElement, mesh }

  constructor() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(2);
    this.renderer.setSize(this.width, this.height);
    this.renderer.setClearColor(0x000000);
  this.labelRenderer.setSize(this.width, this.height);
  this.labelRenderer.domElement.style.position = 'absolute';
  this.labelRenderer.domElement.style.top = '0';
  this.labelRenderer.domElement.style.left = '0';
  // Keep root transparent to pointer events; individual menu elements enable their own pointer events
  this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.controls.target.set(160, 25, -120);
    this.controls.minDistance = 50;
    this.camera.position.set(0, 100, 20);
    this.controls.update();
    this.renderer.clippingPlanes = [this.clippingPlane];
    // Transform controls setup (translate only on ground plane)
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode('translate');
    this.transform.showY = true; // allow X/Y/Z movement (Y for up/down)
    this.transform.setTranslationSnap(1);
    this.transform.addEventListener('dragging-changed', (e) => {
      // Disable orbit while dragging
      this.controls.enabled = !e.value;
      this._transformDragging = !!e.value;
      if (!e.value) {
        // Drag ended -> persist if changed
        this.onTransformEnd();
      }
    });
    // Live change persistence (throttled) when a constrained move is active
    this.transform.addEventListener('change', () => {
      if (this._activeMove) this.onTransformChange();
    });
  this.transform.setSize(1.5);
    this.transform.addEventListener('mouseDown', () => {
      const obj = this.transform.object;
      if (obj) this._dragOrig = obj.position.clone();
    });
  }

  static getInstance() {
    if (this.instance) return this.instance;
    const obj = new this();
    this.instance = obj;
    return obj;
  }

  async init(mountRef) {
    this.ref = mountRef.current;
  this.ref.appendChild(this.stats.dom);
  this.ref.appendChild(this.renderer.domElement);
  this.ref.appendChild(this.labelRenderer.domElement);
  // TransformControls should live in the same scene as devices
  this.deviceScene.add(this.transform);
    window.addEventListener('resize', this.onReize);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
  window.addEventListener('dblclick', this.onDoubleClick);
    window.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
  window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener(FloorSelectEvent.TYPE, this.onFloorSelect);
    this.onAnimate = () => { requestAnimationFrame(this.onAnimate); this.animate(); };
    this.onAnimate();
    const ambientLight = new THREE.AmbientLight(0xb0b0b0);
    const light = new THREE.DirectionalLight(0xf4f4f4);
    light.position.set(0, 100, 0);
    this.scene.add(ambientLight, light);
    try {
      const res = await fetch('/assets/manifest.json');
      if (res.ok) {
        const manifest = await res.json();
        if (manifest && Array.isArray(manifest.layers)) LAYERS = manifest.layers;
      }
    } catch {}
    try {
      const devices = (await apiFetch("/api/devices")).body;
      this.setDevices(devices);
    } catch {}
    const groundGeom = new THREE.PlaneBufferGeometry(300, 300, 8, 8);
    const groundMat = new THREE.MeshBasicMaterial({ color: 0x3f3f3f, side: THREE.DoubleSide });
  const groundPlane = new THREE.Mesh(groundGeom, groundMat);
  groundPlane.rotateX(-Math.PI / 2);
  groundPlane.position.set(160, 0.5, -120);
  this.ground = groundPlane;
  this.scene.add(groundPlane);
    const loader = new GLTFLoader();
    const loadLayer = async (fileName) => {
      const layer = await loader.loadAsync(`/assets/${fileName}`);
      this.scene.add(layer.scene);
    };
    for (const layerName of LAYERS) {
      try {
        await loadLayer(layerName);
      } catch (e) {
        // Log failures so blank scenes are diagnosable (e.g., LFS pointer files instead of real GLBs)
        // eslint-disable-next-line no-console
        console.warn(`[Graphics] Failed to load layer "${layerName}"`, e);
      }
    }
    window.dispatchEvent(new LoadEvent());
  }

  animate() {
    // Devices are stationary (no auto-rotation)
    this.renderer.clear();
    this.controls.update();
    this.updateSpriteScales();
    this.renderer.render(this.scene, this.camera);
  this.renderer.render(this.deviceScene, this.camera);
  // Render CSS2D for interactive device menu when used
  this.labelRenderer.render(this.deviceScene, this.camera);
    this.stats.update();
  }

  updateSpriteScales() {
    // Make icon/lock sprites scale with camera distance so they feel proportional to the model
    const camPos = this.camera.position;
    for (const child of this.deviceScene.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const device = child;
      const icon = device.userData?.deviceIconSprite;
      const lock = device.userData?.lockSprite;
      if (!icon && !lock) continue;
      const dist = camPos.distanceTo(device.position);
      // Tune these numbers to taste: closer -> bigger up to max; farther -> smaller down to min
      const factor = THREE.MathUtils.clamp(120 / Math.max(1, dist), 0.6, 1.6);
      if (icon) icon.scale.set(1.8 * factor, 2.2 * factor, 1);
      if (lock) lock.scale.set(0.9 * factor, 0.9 * factor, 1);
    }
  }

  dispose() {
    this.ref.removeChild(this.renderer.domElement);
  this.ref.removeChild(this.labelRenderer.domElement);
    this.ref.removeChild(this.stats.dom);
    try { this.scene.remove(this.transform); } catch (_) {}
    try { this.transform?.dispose?.(); } catch (_) {}
    window.removeEventListener('resize', this.onReize);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
  window.removeEventListener('dblclick', this.onDoubleClick);
    window.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
  window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener(FloorSelectEvent.TYPE, this.onFloorSelect);
    this.onAnimate = () => { this.animate(); };
    Graphics.instance = undefined;
  }

  setFloor(floor) {
    const perFloor = 12.5;
    const base = 12.5;
    floor = Math.min(Math.max(floor, 0), 7);
    const val = base + perFloor * floor;
    this.clippingPlane.set(this.clippingPlane.normal, val);
  }

  setDevices(devices) {
    if (!devices) return;
    if (this._selectionHud) this.closeSelectionHud();
    this.deviceScene.clear();
    const geom = DEVICE_GEOM;
    for (const device of devices) {
      // Invisible anchor mesh (no visible ring)
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.0, depthWrite: false, depthTest: false });
      const cube = new THREE.Mesh(geom, mat);
      // Ensure torus lies flat on XZ plane (ring around Y axis)
      cube.rotation.x = Math.PI / 2;
      cube.position.set(device.position.x, device.position.y, device.position.z);
      cube.userData = device;
      // Prevent anchor geometry from receiving raycasts (we use a dedicated pick proxy)
      cube.raycast = () => {};
      // Visual cue when pinned previously used emissive on mesh; now handled by lock sprite color
      this.deviceScene.add(cube);
  // Attach in-scene icon/lock sprites and a larger invisible pick proxy for easier selection
  this.attachDeviceIcon(cube);
  this.attachLockSprite(cube);
  this.updateLockSprite(cube);
  this.attachPickProxy(cube);
    }
    // Ensure TransformControls stays in device scene after clear()
    this.deviceScene.add(this.transform);
    const ambientLight = new THREE.AmbientLight(0x404040);
    const light = new THREE.DirectionalLight(0xf4f4f4);
    light.position.set(-100, 100, -100);
    this.deviceScene.add(light, ambientLight);
  }

  attachDeviceIcon(mesh) {
    const mat = new THREE.SpriteMaterial({ map: DEVICE_ICON_TEX, color: DEVICE_COLOR, depthTest: true, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(0, 2.8, 0);
    sprite.scale.set(1.8, 2.2, 1);
    sprite.userData = { kind: 'deviceIcon' };
    sprite.renderOrder = 1;
    mesh.add(sprite);
    mesh.userData.deviceIconSprite = sprite;
  }

  attachLockSprite(mesh) {
    const mat = new THREE.SpriteMaterial({ map: LOCK_CLOSED_TEX, color: 0xffa64d, depthTest: true, depthWrite: false, transparent: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(0, 4, 0);
    sprite.scale.set(0.9, 0.9, 1);
    sprite.userData = { kind: 'lock' };
    sprite.renderOrder = 2; // above icon
    mesh.add(sprite);
    mesh.userData.lockSprite = sprite;
  }

  updateLockSprite(mesh) {
    const sp = mesh.userData?.lockSprite;
    if (!sp) return;
    // Pinned: orange; Unpinned: light gray
    if (mesh.userData?.pinned) {
      sp.material.map = LOCK_CLOSED_TEX;
      sp.material.needsUpdate = true;
      sp.material.color.setHex(0xffa64d);
      sp.material.opacity = 1.0;
    } else {
      sp.material.map = LOCK_OPEN_TEX;
      sp.material.needsUpdate = true;
      sp.material.color.setHex(0xaaaaaa);
      sp.material.opacity = 0.95;
    }
  }

  attachPickProxy(mesh) {
    const geom = new THREE.SphereGeometry(2.4, 12, 12);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.0, depthWrite: false });
    const proxy = new THREE.Mesh(geom, mat);
    proxy.position.set(0, 0.5, 0);
    proxy.userData = { kind: 'pickProxy' };
    mesh.add(proxy);
    mesh.userData.pickProxy = proxy;
  }

  async togglePin(mesh) {
    if (!mesh || !mesh.userData?.name) return;
    const name = mesh.userData.name;
    const nextPinned = !mesh.userData.pinned;
    try {
      const res = await apiFetch(`/api/devices/${encodeURIComponent(name)}`, 'PATCH', { pinned: nextPinned });
      if (!res.ok) {
        const msg = res.body?.error || 'Failed to update pin state';
        // eslint-disable-next-line no-alert
        alert(msg);
        return;
      }
      mesh.userData.pinned = nextPinned;
      // Detach controls if pinned; otherwise reattach if selected and CTRL is held
      if (nextPinned) {
        if (this.transform.object === mesh) this.transform.detach();
      } else {
        if (this._selectedDevice === mesh && this._ctrlPressed) this.transform.attach(mesh);
      }
      this.updateLockSprite(mesh);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      // eslint-disable-next-line no-alert
      alert('Error updating pin state');
    }
  }

  async handleContextMenu(event) {
    // Allow RMB orbit by default; only intercept when right-clicking directly on the lock sprite
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
    // Ignore context menu from HUD/menu buttons
    const hudRoot = this.labelRenderer?.domElement;
    if (hudRoot && hudRoot.contains(event.target) && event.target?.closest && event.target.closest('button')) return;
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.rayCaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.rayCaster.intersectObjects(this.deviceScene.children, true);
    const lockHit = intersects.find(h => h.object?.userData?.kind === 'lock');
    if (!lockHit) {
      // Not on a lock: deselect if not clicking any device; otherwise allow RMB orbit
      let obj = intersects?.[0]?.object;
      while (obj && !obj.userData?.name && obj.parent) obj = obj.parent;
      if (!obj || !obj.userData?.name) this.deselectDevice();
      return;
    }
    event.preventDefault();
    this.closeMoveMenu();
    const parent = lockHit.object.parent;
    if (parent) await this.togglePin(parent);
  }

  async handleKeyDown(event) {
    if (event.key === 'Escape') {
      this.deselectDevice();
      return;
    }
    if (event.key.toLowerCase() === 'p') {
      const mesh = this._selectedDevice || this._hoveredDevice;
      if (mesh) await this.togglePin(mesh);
    }
    if (event.key === 'Control') {
      this._ctrlPressed = true;
      // Attach transform only while CTRL is held on selected unpinned device
      const mesh = this._selectedDevice;
      if (mesh && !mesh.userData?.pinned) {
        this.transform.attach(mesh);
        this.transform.showX = true;
        this.transform.showZ = true;
        this.transform.showY = true;
      }
  // Hint cursor for move-ready
  this.renderer.domElement.style.cursor = 'grab';
    }
  }

  async handleKeyUp(event) {
    if (event.key === 'Control') {
      this._ctrlPressed = false;
      if (!this._transformDragging) {
        this.transform.detach();
      }
  this.renderer.domElement.style.cursor = '';
    }
  }

  resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(this.width, this.height);
  }

  pointerMove(event) {
    // Manual ground dragging when selected, not pinned, and not using transform gizmo
    if (this._dragging && this._dragDevice) {
      const canvas = this.renderer.domElement;
      const rect = canvas.getBoundingClientRect();
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.rayCaster.setFromCamera(this.pointer, this.camera);
      if (this.ground) {
        const intersects = this.rayCaster.intersectObject(this.ground, false);
        if (intersects.length) {
          const p = intersects[0].point;
          const dx = this._dragDelta?.x || 0;
          const dz = this._dragDelta?.z || 0;
          this._dragDevice.position.set(Math.round(p.x + dx), this._dragOrig.y, Math.round(p.z + dz));
        }
      }
      return;
    }

  const canvas = this.renderer.domElement;
  const rect = canvas.getBoundingClientRect();
  this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.rayCaster.setFromCamera(this.pointer, this.camera);
    const intersects = this.rayCaster.intersectObjects(this.deviceScene.children, true);
    // Cursor hint when hovering lock sprite
    if (intersects[0]?.object?.userData?.kind === 'lock') {
      this.renderer.domElement.style.cursor = 'pointer';
    } else if (this._ctrlPressed && this._selectedDevice && !this._selectedDevice.userData?.pinned) {
      this.renderer.domElement.style.cursor = 'grab';
    } else if (!this._transformDragging) {
      this.renderer.domElement.style.cursor = '';
    }
    if (intersects.length) {
      let obj = intersects[0].object;
      // Map child (sprite/proxy) to the device mesh (parent with userData.name)
      while (obj && !obj.userData?.name && obj.parent) obj = obj.parent;
      if (obj && obj.userData?.name) this.deviceHoverEnter(obj);
    } else if (this._hoveredDevice) {
      const device = this._hoveredDevice;
      this.deviceHoverExit(device);
    }
  }

  pointerDown(event) {
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    // Click-away: if left-click outside the canvas and not on HUD buttons, deselect
    const hudRoot = this.labelRenderer?.domElement;
    if (event.button === 0) {
      const onHudButton = !!(hudRoot && hudRoot.contains(event.target) && event.target?.closest && event.target.closest('button'));
      const outsideCanvas = event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
      if (!onHudButton && outsideCanvas) {
        this.deselectDevice();
        return;
      }
    }
    // Ignore pointer downs that originate from HUD/menu buttons
    if (hudRoot && hudRoot.contains(event.target) && event.target?.closest && event.target.closest('button')) {
      return;
    }
    this.pointerMove(event);
    this.closeMoveMenu();
    if (event.button === 0) {
      // Check if lock sprite is clicked (search all hits, not only closest)
      // (canvas/rect already computed above)
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.rayCaster.setFromCamera(this.pointer, this.camera);
      const allHits = this.rayCaster.intersectObjects(this.deviceScene.children, true);
      if (allHits.length) {
        const lockHit = allHits.find(h => h.object?.userData?.kind === 'lock');
        if (lockHit) {
          const parent = lockHit.object.parent;
          if (parent) {
            this.togglePin(parent).then(() => {
              if (this._selectedDevice === parent) this.refreshSelectionHud(parent);
            });
          }
          return;
        }
      }
    }
    if (event.button === 0) {
      // Only select if we actually clicked a device element (sprite/proxy or the device mesh itself)
      // (canvas/rect already computed above)
      this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      this.rayCaster.setFromCamera(this.pointer, this.camera);
      const hits = this.rayCaster.intersectObjects(this.deviceScene.children, true);
      // If clicking the transform gizmo, let it handle the interaction (do not deselect)
      const gizmoHit = this.rayCaster.intersectObject(this.transform, true).length > 0;
      let obj = hits?.[0]?.object;
      while (obj && !obj.userData?.name && obj.parent) obj = obj.parent;
      if (!obj || !obj.userData?.name) {
        if (!gizmoHit) this.deselectDevice();
        return; // clicked empty space or gizmo
      }
      const mesh = obj;
      this.devicePointerDown(mesh);
      // Begin manual drag only if CTRL is pressed, not pinned, not using transform gizmo,
      // and the pointer is NOT over the transform gizmo (so gizmo can be used for X/Y/Z)
      const overGizmo = this.rayCaster.intersectObject(this.transform, true).length > 0;
      if (event.ctrlKey && !mesh.userData?.pinned && !this._transformDragging && !overGizmo) {
        this._dragging = true;
        this._dragDevice = mesh;
        this._dragOrig = mesh.position.clone();
        // Calculate initial ground intersection and delta so the cursor stays under the same relative point
        const canvas = this.renderer.domElement;
        const rect = canvas.getBoundingClientRect();
        this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        this.rayCaster.setFromCamera(this.pointer, this.camera);
        let dx = 0, dz = 0;
        if (this.ground) {
          const hit = this.rayCaster.intersectObject(this.ground, false)[0];
          if (hit) {
            dx = this._dragOrig.x - hit.point.x;
            dz = this._dragOrig.z - hit.point.z;
          }
        }
        this._dragDelta = { x: dx, z: dz };
        this.controls.enabled = false;
        // Detach transform during manual drag to avoid conflicting controls
        if (this.transform.object === mesh) this.transform.detach();
      }
  }
  }

  async pointerUp(event) {
    if (!this._dragging || !this._dragDevice) return;
    const mesh = this._dragDevice;
    this._dragging = false;
    this._dragDevice = undefined;
    this.controls.enabled = true;

    const newPos = mesh.position;
    const origPos = this._dragOrig;
    this._dragOrig = undefined;
    this._dragDelta = undefined;
    if (!origPos || (origPos.x === newPos.x && origPos.y === newPos.y && origPos.z === newPos.z)) {
      // Reattach transform if still selected, unpinned and CTRL pressed
      if (this._selectedDevice === mesh && !mesh.userData?.pinned && this._ctrlPressed) this.transform.attach(mesh);
      return;
    }
    const name = mesh.userData?.name;
    if (!name) return;
    try {
      const res = await apiFetch(`/api/devices/${encodeURIComponent(name)}`, 'PATCH', {
        position: { x: newPos.x, y: newPos.y, z: newPos.z },
      });
      if (!res.ok) {
        mesh.position.copy(origPos);
        const msg = res.body?.error || 'Failed to update device position';
        alert(msg);
      } else {
        mesh.userData.position = { x: newPos.x, y: newPos.y, z: newPos.z };
      }
    } catch (e) {
      mesh.position.copy(origPos);
      console.error(e);
      alert('Error updating device position');
    } finally {
      if (this._selectedDevice === mesh && !mesh.userData?.pinned && this._ctrlPressed) this.transform.attach(mesh);
    }
  }

  async onTransformEnd() {
    const obj = this.transform.object;
    if (!obj) return;
    const newPos = obj.position;
    const origPos = this._dragOrig;
    this._dragOrig = undefined;
    if (!origPos || (origPos.x === newPos.x && origPos.y === newPos.y && origPos.z === newPos.z)) return;
    const name = obj.userData?.name;
    if (!name) return;
    try {
      const res = await apiFetch(`/api/devices/${encodeURIComponent(name)}`, 'PATCH', {
        position: { x: Math.round(newPos.x), y: Math.round(newPos.y), z: Math.round(newPos.z) },
      });
      if (!res.ok) {
        obj.position.copy(origPos);
        const msg = res.body?.error || 'Failed to update device position';
        alert(msg);
        return;
      }
      obj.userData.position = { x: newPos.x, y: newPos.y, z: newPos.z };
      // If this move was initiated via constrained menu, auto lock afterwards
      if (this._lockAfterMove && !obj.userData?.pinned) await this.togglePin(obj);
    } catch (e) {
      obj.position.copy(origPos);
      console.error(e);
      alert('Error updating device position');
    } finally {
      // Reset move state flags
      this._activeMove = undefined;
      this._lockAfterMove = false;
      this._unpinnedByMove = false;
      if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = undefined; }
    }
  }

  // Raycast into the floor and capture a world position to add a device
  async handleDoubleClick(event) {
    // Only consider double-clicks inside the canvas area
    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return;
  // First, check if a device was double-clicked and focus it (open HUD)
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.rayCaster.setFromCamera(this.pointer, this.camera);
    const hitObjs = this.rayCaster.intersectObjects(this.deviceScene.children, true);
    if (hitObjs.length) {
      let obj = hitObjs[0].object;
      while (obj && !obj.userData?.name && obj.parent) obj = obj.parent;
      if (obj && obj.userData?.name) {
        this.devicePointerDown(obj);
        return;
      }
    }
    // Otherwise, double-click on empty ground -> create a device
    // Build a ground picking plane at y=70 (roughly the device y in sample data)
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.rayCaster.setFromCamera(this.pointer, this.camera);

    // Intersect with the ground plane we added (rotateX(-PI/2) at y=0.5)
    const ground = this.scene.children.find((o) => o.isMesh && o.geometry?.parameters?.width === 300 && o.material?.color?.getHex && o.material.color.getHex() === 0x3f3f3f);
    let point;
    if (ground) {
      const intersects = this.rayCaster.intersectObject(ground, false);
      if (intersects.length) point = intersects[0].point;
    }
    if (!point) return;

    // Snap to integers for neatness
    const position = { x: Math.round(point.x), y: 70, z: Math.round(point.z) };

    // Prompt minimal details; can be replaced with a proper modal later
    const name = window.prompt('Device name (unique):');
    if (!name) return;
    const type = window.prompt('Device type (e.g., corridor, teaching_space):') || 'generic';
    const floorStr = window.prompt('Floor number (e.g., 5):', '5');
    const floor = Number(floorStr);
    if (Number.isNaN(floor)) return alert('Invalid floor');

    try {
      const res = await apiFetch('/api/devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type, floor, position }),
      });
      if (!res.ok) {
        const msg = res.body?.error || 'Failed to create device';
        return alert(msg);
      }
      // Refresh devices from API and re-render
      const devices = (await apiFetch('/api/devices')).body;
      this.setDevices(devices);
      // Optionally select the newly created device
      const created = res.body;
      const mesh = this.deviceScene.children.find((c) => c.userData?.name === created?.name);
      if (mesh) this.devicePointerDown(mesh);
    } catch (e) {
      // eslint-disable-next-line no-alert
      alert('Error creating device');
      // eslint-disable-next-line no-console
      console.error(e);
    }
  }

  deviceHoverEnter(device) {
    this._hoveredDevice = device;
    if (device === this._selectedDevice) return;
    if (device.userData?.deviceIconSprite) device.userData.deviceIconSprite.material.color.set(DEVICE_HOVER_COLOR);
  }

  deviceHoverExit(device) {
    this._hoveredDevice = undefined;
    if (device === this._selectedDevice) return;
    if (device.userData?.deviceIconSprite) device.userData.deviceIconSprite.material.color.set(DEVICE_COLOR);
  }

  devicePointerDown(device) {
    if (device !== this._selectedDevice && this._selectedDevice) {
      const selectedDevice = this._selectedDevice;
      // Reset previous selection icon color
  if (selectedDevice.userData?.deviceIconSprite) selectedDevice.userData.deviceIconSprite.material.color.set(DEVICE_COLOR);
    }
    this._selectedDevice = device;
    if (device) {
      // Highlight via icon sprite color
      if (device.userData?.deviceIconSprite) device.userData.deviceIconSprite.material.color.set(DEVICE_SELECTED_COLOR);
      // Attach transform controls only when CTRL is pressed and not pinned
      if (!device.userData?.pinned) {
        if (this._ctrlPressed || this._activeMove) {
          this.transform.attach(device);
          // If constrained move active, enforce axis visibility
          if (this._activeMove === 'Y') {
            this.transform.showX = false; this.transform.showZ = false; this.transform.showY = true;
          } else if (this._activeMove === 'XZ') {
            this.transform.showX = true; this.transform.showZ = true; this.transform.showY = false;
          } else {
            this.transform.showX = true; this.transform.showZ = true; this.transform.showY = true;
          }
        } else {
          this.transform.detach();
        }
      } else {
        this.transform.detach();
      }
      this.openSelectionHud(device);
    }
    window.dispatchEvent(new DeviceSelectEvent(device.userData.name));
  }

  // Public helpers for external UI
  getDeviceMeshByName(name) {
    if (!name) return undefined;
    for (const child of this.deviceScene.children) {
      if (child?.userData?.name === name) return child;
    }
    return undefined;
  }

  async togglePinByName(name) {
    const mesh = this.getDeviceMeshByName(name);
    if (mesh) await this.togglePin(mesh);
  }

  async startMoveModeByName(name, mode) {
    const mesh = this.getDeviceMeshByName(name);
    if (!mesh) return;
    await this.startMoveMode(mesh, mode);
  }

  openSelectionHud(mesh) {
    this.closeSelectionHud();
    const el = document.createElement('div');
    el.className = 'selection-hud';
    // Let only inner buttons receive pointer events so wheel/RMB pass through to canvas
    el.style.pointerEvents = 'none';
    el.style.background = 'rgba(17,24,39,0.95)';
    el.style.color = '#fff';
    el.style.padding = '6px 8px';
    el.style.borderRadius = '8px';
    el.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    el.style.fontSize = '12px';
    el.style.display = 'grid';
    el.style.gap = '6px';
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.45)';
    el.style.minWidth = '160px';
    const name = mesh.userData?.name || 'Device';
    const isPinned = !!mesh.userData?.pinned;
    const lockLabel = isPinned ? '🔓 Unlock' : '🔒 Lock';
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="opacity:.9;">${name}</div>
        <button data-action="close" title="Close" style="all:unset;cursor:pointer;padding:4px 6px;border-radius:6px;background:#111827;pointer-events:auto;">✕</button>
      </div>
      <div style="display:flex;gap:6px;">
        <button data-action="toggle" style="all:unset;cursor:pointer;padding:6px 8px;border-radius:6px;background:#1f2937;pointer-events:auto;">${lockLabel}</button>
        <button data-action="moveY" style="all:unset;cursor:pointer;padding:6px 8px;border-radius:6px;background:#1f2937;pointer-events:auto;">↕ Move</button>
        <button data-action="moveXZ" style="all:unset;cursor:pointer;padding:6px 8px;border-radius:6px;background:#1f2937;pointer-events:auto;">↔ Move</button>
      </div>
    `;
    Array.from(el.querySelectorAll('button')).forEach((b) => {
      b.addEventListener('mouseenter', () => { b.style.background = '#374151'; });
      b.addEventListener('mouseleave', () => { b.style.background = '#1f2937'; });
    });
    const obj = new CSS2DObject(el);
    obj.position.set(0, 5.6, 0);
    mesh.add(obj);
    this._selectionHud = { obj, el, mesh };
    // Root stays pointer-events:none; only buttons receive clicks
    const onClick = async (e) => {
      e.stopPropagation();
      const action = e.currentTarget.getAttribute('data-action');
      if (action === 'close') {
        this.deselectDevice();
        return;
      }
      if (action === 'toggle') {
        await this.togglePin(mesh);
        this.refreshSelectionHud(mesh);
        return;
      }
      if (action === 'moveY' || action === 'moveXZ') {
        await this.startMoveMode(mesh, action === 'moveY' ? 'Y' : 'XZ');
      }
    };
    el.querySelector('[data-action="close"]').addEventListener('click', onClick);
    el.querySelector('[data-action="toggle"]').addEventListener('click', onClick);
    el.querySelector('[data-action="moveY"]').addEventListener('click', onClick);
    el.querySelector('[data-action="moveXZ"]').addEventListener('click', onClick);
  }

  refreshSelectionHud(mesh) {
    if (!this._selectionHud || this._selectionHud.mesh !== mesh) return;
    const isPinned = !!mesh.userData?.pinned;
    const btn = this._selectionHud.el.querySelector('[data-action="toggle"]');
    if (btn) btn.textContent = isPinned ? '🔓 Unlock' : '🔒 Lock';
  }

  closeSelectionHud() {
    if (!this._selectionHud) return;
    try { this._selectionHud.mesh.remove(this._selectionHud.obj); } catch (_) {}
    this._selectionHud = undefined;
    // Keep CSS2D root non-interactive
  }

  openMoveMenu(mesh) {
    this.closeMoveMenu();
    const el = document.createElement('div');
    el.className = 'move-menu';
    // Enable pointer events only on the buttons
    el.style.pointerEvents = 'none';
    el.style.background = 'rgba(17,24,39,0.95)';
    el.style.color = '#fff';
    el.style.padding = '8px 10px';
    el.style.borderRadius = '8px';
    el.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
    el.style.fontSize = '12px';
    el.style.display = 'grid';
    el.style.gap = '6px';
    el.style.minWidth = '180px';
    el.style.boxShadow = '0 6px 18px rgba(0,0,0,0.45)';
    const isPinned = !!mesh.userData?.pinned;
    const lockLabel = isPinned ? '🔓 Unlock position' : '🔒 Lock position';
    el.innerHTML = `
      <button data-action="lock" style="all:unset;cursor:pointer;padding:6px 8px;border-radius:6px;background:#1f2937;pointer-events:auto;">${lockLabel}</button>
      <button data-action="moveY" style="all:unset;cursor:pointer;padding:6px 8px;border-radius:6px;background:#1f2937;pointer-events:auto;">↕ Move up/down</button>
      <button data-action="moveXZ" style="all:unset;cursor:pointer;padding:6px 8px;border-radius:6px;background:#1f2937;pointer-events:auto;">↔ Move left/right</button>
    `;
    Array.from(el.querySelectorAll('button')).forEach((b) => {
      b.addEventListener('mouseenter', () => { b.style.background = '#374151'; });
      b.addEventListener('mouseleave', () => { b.style.background = '#1f2937'; });
    });
    const obj = new CSS2DObject(el);
    obj.position.set(0, 5.2, 0);
    mesh.add(obj);
    this._moveMenu = { obj, el, mesh };
    // Root remains non-interactive; only buttons accept clicks
    const clickHandler = async (e) => {
      e.stopPropagation();
      const action = e.currentTarget.getAttribute('data-action');
      if (action === 'lock') {
        // Context-aware: lock if currently unlocked; unlock if currently locked
        await this.togglePin(mesh);
        this.closeMoveMenu();
        return;
      }
      if (action === 'moveY' || action === 'moveXZ') {
        await this.startMoveMode(mesh, action === 'moveY' ? 'Y' : 'XZ');
        this.closeMoveMenu();
      }
    };
    el.querySelector('[data-action="lock"]').addEventListener('click', clickHandler);
    el.querySelector('[data-action="moveY"]').addEventListener('click', clickHandler);
    el.querySelector('[data-action="moveXZ"]').addEventListener('click', clickHandler);
  }

  closeMoveMenu() {
    if (!this._moveMenu) return;
    try { this._moveMenu.mesh.remove(this._moveMenu.obj); } catch (_) {}
    this._moveMenu = undefined;
    // CSS2D root stays pointer-events:none
  }

  async startMoveMode(mesh, mode) {
    // Ensure device is selected
    this.devicePointerDown(mesh);
    // Ensure unlocked before moving
    this._unpinnedByMove = false;
    if (mesh.userData?.pinned) {
      await this.togglePin(mesh);
      this._unpinnedByMove = true;
    }
    this._activeMove = mode; // 'Y' or 'XZ'
    this._lockAfterMove = true;
    // Attach and constrain axes
    this.transform.attach(mesh);
    this.transform.setMode('translate');
    if (mode === 'Y') {
      this.transform.showX = false; this.transform.showZ = false; this.transform.showY = true;
    } else {
      this.transform.showX = true; this.transform.showZ = true; this.transform.showY = false;
    }
  }

  async onTransformChange() {
    const obj = this.transform.object;
    if (!obj || !obj.userData?.name) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(async () => {
      const pos = obj.position;
      try {
        const res = await apiFetch(`/api/devices/${encodeURIComponent(obj.userData.name)}`, 'PATCH', {
          position: { x: Math.round(pos.x), y: Math.round(pos.y), z: Math.round(pos.z) },
        });
        if (res.ok) obj.userData.position = { x: pos.x, y: pos.y, z: pos.z };
      } catch (_) {
        // ignore transient errors during drag
      }
    }, 150);
  }
}
