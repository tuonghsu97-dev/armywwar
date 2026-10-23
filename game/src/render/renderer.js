// Renderer: scene, lights, 2.5D isometric camera (GDD §2: tilt 45–55°, 4 rotations, 3 zoom levels),
// screen<->world picking and building fade when buildings hide units.
import * as THREE from 'three';
import { buildTerrain } from './terrain.js';

export const ZOOMS = [{ name: 'Chiến lược', h: 175 }, { name: 'Chiến thuật', h: 92 }, { name: 'Cận cảnh', h: 42 }];
const TILT = THREE.MathUtils.degToRad(50);

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFShadowMap;
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.toneMapping = THREE.ACESFilmicToneMapping;
    this.r.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x9fb6c6);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -500, 1000);
    this.target = new THREE.Vector3(60, 0, 75);
    this.yawIndex = 0;           // 0..3 → 45°, 135°, 225°, 315°
    this.yaw = Math.PI / 4;
    this.zoomIndex = 1;
    this.viewH = ZOOMS[1].h;
    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.updaters = [];
    this.setupLights();
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setupLights() {
    this.hemi = new THREE.HemisphereLight(0xdfefff, 0x4a4a3a, 1.1);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const s = this.sun.shadow.camera; s.left = -110; s.right = 110; s.top = 110; s.bottom = -110; s.near = 1; s.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);
  }

  setMap(map) {
    this.map = map;
    this.world = buildTerrain(this.scene, map);
    const fogColor = { clear: 0x9fb6c6, rain: 0x7d8a94, fog: 0xb8c3c8 }[map.weather] || 0x9fb6c6;
    this.scene.background = new THREE.Color(fogColor);
    this.target.set(map.bases[0].x + 45, 0, map.bases[0].z);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.r.setSize(w, h, false);
    this.post?.setSize(w, h); // post-processing (fx agent, render/post.js)
    this.aspect = w / h;
    this.updateCamera();
  }

  rotate(dir) {
    this.yawIndex = (this.yawIndex + dir + 4) % 4;
  }
  setZoom(i) { this.zoomIndex = Math.max(0, Math.min(2, i)); }
  zoomStep(d) { this.setZoom(this.zoomIndex + d); }

  pan(dx, dz) {
    // Pan in screen-aligned directions.
    const f = new THREE.Vector3(-Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const r = new THREE.Vector3(-f.z, 0, f.x);
    this.target.addScaledVector(r, dx).addScaledVector(f, dz);
    if (this.map) {
      this.target.x = Math.max(-10, Math.min(this.map.w + 10, this.target.x));
      this.target.z = Math.max(-10, Math.min(this.map.h + 10, this.target.z));
    }
  }
  focus(x, z) { this.target.set(x, 0, z); }

  updateCamera(dt = 0) {
    const wantYaw = Math.PI / 4 + this.yawIndex * Math.PI / 2;
    let d = wantYaw - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += dt ? d * Math.min(1, dt * 8) : d;
    const wantH = ZOOMS[this.zoomIndex].h;
    this.viewH += dt ? (wantH - this.viewH) * Math.min(1, dt * 8) : wantH - this.viewH;
    const h = this.viewH, w = h * this.aspect;
    const c = this.camera;
    c.left = -w / 2; c.right = w / 2; c.top = h / 2; c.bottom = -h / 2;
    c.updateProjectionMatrix();
    const dist = 200;
    c.position.set(
      this.target.x + Math.cos(this.yaw) * Math.cos(TILT) * dist,
      this.target.y + Math.sin(TILT) * dist,
      this.target.z + Math.sin(this.yaw) * Math.cos(TILT) * dist);
    c.lookAt(this.target);
    // Shadow camera follows the view.
    this.sun.position.set(this.target.x - 60, 120, this.target.z - 40);
    this.sun.target.position.copy(this.target);
    const sc = this.sun.shadow.camera, ext = Math.max(60, h * 0.9 * Math.max(1, this.aspect) * 0.6);
    sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.updateProjectionMatrix();
  }

  // Screen (client px) -> world point on ground plane y=0.
  pick(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, p) ? p : null;
  }
  toScreen(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const rect = this.canvas.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * rect.width + rect.left, y: (1 - v.y) / 2 * rect.height + rect.top, onScreen: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
  }

  // Fade city blocks that sit between the camera and friendly/visible units (F-13).
  fadeBuildings(points) {
    if (!this.world?.buildings.length) return;
    const camDir = new THREE.Vector3(Math.cos(this.yaw), 0, Math.sin(this.yaw));
    for (const b of this.world.buildings) {
      const bb = b.userData.bounds;
      let hide = false;
      for (const p of points) {
        // A building hides p if p lies "behind" it from the camera, within its height shadow on the ground.
        const reach = bb.maxh / Math.tan(TILT) + 1;
        const cx = Math.max(bb.minx, Math.min(bb.maxx, p.x)), cz = Math.max(bb.minz, Math.min(bb.maxz, p.z));
        const dx = cx - p.x, dz = cz - p.z;
        const along = dx * camDir.x + dz * camDir.z;      // >0 means building is toward the camera
        const side = Math.abs(-dx * camDir.z + dz * camDir.x);
        if ((along >= -0.5 && along <= reach && side < 2.5) || (p.x > bb.minx && p.x < bb.maxx && p.z > bb.minz && p.z < bb.maxz)) { hide = true; break; }
      }
      const want = hide ? 0.28 : 1;
      b.material.opacity += (want - b.material.opacity) * 0.2;
      b.material.depthWrite = !!b.userData.dither || b.material.opacity > 0.95; // fx.js dithered fade keeps depth (x-ray outlines)
    }
    this.world.syncFade?.(); // merged city mesh (terrain.js): upload per-block fade
  }

  render(dt) {
    this.updateCamera(dt);
    for (const u of this.updaters) u(dt);
    if (this.post) this.post.render(dt); else this.r.render(this.scene, this.camera);
  }
}
