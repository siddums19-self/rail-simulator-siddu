import * as THREE from 'three/webgpu';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { ASSETS_BASE } from '../config.js';
import { mulberry32 } from '../core/rng.js';

// Physically based atmosphere (Preetham sky with volumetric-looking clouds),
// sun/moon lights, stars, fog and a PMREM environment that is re-baked as the
// sun moves so trains and steel reflect the actual sky.

const WEATHER = {
  CLEAR:   { turbidity: 5.5, rayleigh: 1.5, mie: 0.004, cover: 0.32, density: 0.45, fog: 0.00021, sun: 1.0, fogTint: [1, 1, 1] },
  HAZE:    { turbidity: 11,  rayleigh: 1.1, mie: 0.008, cover: 0.2,  density: 0.3,  fog: 0.00055, sun: 0.85, fogTint: [1.05, 1.0, 0.92] },
  MONSOON: { turbidity: 14,  rayleigh: 0.7, mie: 0.01,  cover: 0.96, density: 0.92, fog: 0.0016,  sun: 0.35, fogTint: [0.7, 0.74, 0.78] },
  FOG:     { turbidity: 20,  rayleigh: 0.4, mie: 0.02,  cover: 0.7,  density: 0.6,  fog: 0.0062,  sun: 0.4,  fogTint: [0.92, 0.92, 0.94] }
};

export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = new SkyMesh();
    this.sky.scale.setScalar(4000);
    this.sky.frustumCulled = false;
    this.sky.cloudScale.value = 0.00018;
    this.sky.cloudElevation.value = 0.55;
    scene.add(this.sky);

    this.envScene = new THREE.Scene();
    this.envSky = new SkyMesh();
    this.envSky.scale.setScalar(50);
    this.envSky.frustumCulled = false;
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvKey = '';
    this.hdr = null;

    this.sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.radius = 3;
    const sc = this.sun.shadow.camera;
    sc.near = 10; sc.far = 900; sc.left = -170; sc.right = 170; sc.top = 170; sc.bottom = -170;
    scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x9db4ff, 0);
    scene.add(this.moon, this.moon.target);
    this.hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a4632, 0.9);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xbfd2e6, 0.0002);

    this._buildStars();
    this._buildHorizon();
    this._buildClouds();
    this._buildNightDome();
    this._buildFogDome();
    this.sunDir = new THREE.Vector3();
    this.night = 0;

    new HDRLoader().load(`${ASSETS_BASE}/env/sky.hdr`, (t) => {
      t.mapping = THREE.EquirectangularReflectionMapping;
      this.hdr = t;
    }, undefined, () => {});
  }

  setShadowSize(n) {
    this.sun.shadow.mapSize.set(n, n);
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
  }

  _buildStars() {
    const n = 900;
    const rand = mulberry32(42);
    const geo = new THREE.PlaneGeometry(1, 1);
    this.starMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, fog: false, depthWrite: false });
    const stars = new THREE.InstancedMesh(geo, this.starMat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const o = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      p.set(r * Math.cos(th), Math.abs(u) * 0.95 + 0.05, r * Math.sin(th)).normalize().multiplyScalar(3200);
      o.position.copy(p); o.lookAt(0, 0, 0); o.updateMatrix();
      const k = 2 + rand() * 5;
      m.compose(p, o.quaternion, s.set(k, k, k));
      stars.setMatrixAt(i, m);
    }
    stars.frustumCulled = false;
    stars.renderOrder = -1;
    this.stars = stars;
    this.scene.add(stars);
  }

  // Night sky gradient (deep blue zenith, faint warm town glow at the horizon),
  // blended over the physical sky after sunset so nights are blue, not brown.
  _buildNightDome() {
    const g = new THREE.SphereGeometry(3300, 32, 16);
    const pos = g.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 3300;
      const t = Math.max(0, y);
      const glow = Math.max(0, 1 - Math.abs(y) * 8) * 0.6;
      col.push(0.012 + 0.05 * (1 - t) + glow * 0.09, 0.018 + 0.06 * (1 - t) + glow * 0.05, 0.05 + 0.1 * (1 - t) + glow * 0.02);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.nightMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.nightDome = new THREE.Mesh(g, this.nightMat);
    this.nightDome.renderOrder = -2;
    this.nightDome.frustumCulled = false;
    this.scene.add(this.nightDome);
  }

  // Fog dome: in winter fog / haze the whole sky dissolves into the fog colour
  // (slightly brighter overhead), hiding distant hills, clouds and stars.
  _buildFogDome() {
    const g = new THREE.SphereGeometry(3150, 32, 16);
    const pos = g.attributes.position, col = [];
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 3150;
      const k = y > 0 ? 1 + 0.12 * Math.sqrt(y) : 1 - 0.1 * Math.min(1, -y * 4);
      col.push(k, k, k);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.fogDomeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.fogDome = new THREE.Mesh(g, this.fogDomeMat);
    this.fogDome.renderOrder = -1;
    this.fogDome.frustumCulled = false;
    this.scene.add(this.fogDome);
  }

  // Ring of distant hills that fades into the haze on the horizon.
  _buildHorizon() {
    const seg = 256, R = 3700;
    const pos = [], col = [], idx = [];
    const rand = mulberry32(77);
    const ph = [rand() * 6.28, rand() * 6.28, rand() * 6.28];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const h = 70 + 110 * Math.max(0, Math.sin(a * 3 + ph[0])) + 60 * Math.sin(a * 7 + ph[1]) ** 2 + 40 * Math.abs(Math.sin(a * 19 + ph[2]));
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      pos.push(x, -30, z, x, h, z);
      col.push(0.32, 0.34, 0.36, 0.5, 0.55, 0.62);
    }
    for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    this.horizonMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true });
    this.horizon = new THREE.Mesh(g, this.horizonMat);
    this.horizon.frustumCulled = false;
    this.scene.add(this.horizon);
  }

  // Billboard cumulus clouds: soft procedural puffs drifting with the wind.
  _buildClouds() {
    const tex = [];
    for (let v = 0; v < 4; v++) {
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const ctx = c.getContext('2d');
      const rand = mulberry32(100 + v);
      for (let i = 0; i < 60; i++) {
        const x = 40 + rand() * 176, y = 50 + rand() * 50 - Math.abs(x - 128) * 0.15;
        const r = 14 + rand() * 30 * (1 - Math.abs(x - 128) / 200);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        const shade = 235 + Math.floor(rand() * 20);
        g.addColorStop(0, `rgba(${shade},${shade},${shade},0.55)`);
        g.addColorStop(0.6, `rgba(${shade - 20},${shade - 18},${shade - 12},0.25)`);
        g.addColorStop(1, 'rgba(200,205,215,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
      // flat, slightly darker base like real cumulus
      const base = ctx.createLinearGradient(0, 70, 0, 128);
      base.addColorStop(0, 'rgba(0,0,0,0)'); base.addColorStop(1, 'rgba(120,128,140,0.25)');
      ctx.globalCompositeOperation = 'source-atop'; ctx.fillStyle = base; ctx.fillRect(0, 0, 256, 128);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
      tex.push(t);
    }
    const rand = mulberry32(7);
    this.clouds = [];
    this.cloudGroup = new THREE.Group();
    for (let i = 0; i < 70; i++) {
      const m = new THREE.SpriteMaterial({ map: tex[i % 4], transparent: true, depthWrite: false, fog: false, color: 0xffffff, opacity: 0.9 });
      const sp = new THREE.Sprite(m);
      const w = 500 + rand() * 900;
      sp.scale.set(w, w * (0.42 + rand() * 0.15), 1);
      sp.userData = { x: (rand() - 0.5) * 7000, z: (rand() - 0.5) * 7000, y: 650 + rand() * 650 };
      sp.renderOrder = -0.5;
      this.cloudGroup.add(sp);
      this.clouds.push(sp);
    }
    this.scene.add(this.cloudGroup);
    this.wind = new THREE.Vector2(6, 2.5);
  }

  _updateClouds(dt, camera, W, golden, day, weatherKey) {
    const n = weatherKey === 'FOG' ? 0 : Math.round(this.clouds.length * Math.min(1, W.cover + 0.15));
    const dark = weatherKey === 'MONSOON' ? 0.55 : 1;
    const col = new THREE.Color().setRGB((0.18 + 0.82 * day) * dark * (1 + golden * 0.15), (0.2 + 0.78 * day) * dark * (1 - golden * 0.12), (0.26 + 0.74 * day) * dark * (1 - golden * 0.3));
    this.clouds.forEach((sp, i) => {
      const u = sp.userData;
      u.x += this.wind.x * dt; u.z += this.wind.y * dt;
      let dx = u.x - camera.position.x, dz = u.z - camera.position.z;
      if (dx > 3500) u.x -= 7000; if (dx < -3500) u.x += 7000;
      if (dz > 3500) u.z -= 7000; if (dz < -3500) u.z += 7000;
      sp.position.set(u.x, u.y + (weatherKey === 'MONSOON' ? -250 : 0), u.z);
      sp.visible = i < n;
      sp.material.color.copy(col);
      sp.material.opacity = weatherKey === 'MONSOON' ? 0.95 : 0.85;
    });
  }

  update(gameMinutes, weatherKey, camera, focus, dt = 0.016) {
    const W = WEATHER[weatherKey] || WEATHER.CLEAR;
    const h = gameMinutes / 60;
    const elev = Math.sin(((h - 6) / 12) * Math.PI) * (72 * Math.PI / 180);
    const az = ((90 + ((h - 6) / 12) * 180) * Math.PI) / 180;
    const ce = Math.cos(elev);
    this.sunDir.set(ce * Math.sin(az), Math.sin(elev), -ce * Math.cos(az)).normalize();
    const day = THREE.MathUtils.smoothstep(this.sunDir.y, -0.08, 0.22);
    const golden = THREE.MathUtils.smoothstep(this.sunDir.y, -0.05, 0.08) * (1 - THREE.MathUtils.smoothstep(this.sunDir.y, 0.1, 0.35));
    this.night = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, -0.12, 0.05);

    for (const sk of [this.sky, this.envSky]) {
      sk.sunPosition.value.copy(this.sunDir);
      sk.turbidity.value = W.turbidity;
      sk.rayleigh.value = W.rayleigh;
      sk.mieCoefficient.value = W.mie;
    }
    this.sky.cloudCoverage.value = W.cover;
    this.sky.showSunDisc.value = W.cover > 0.65 ? 0 : 1; // no sun disc through monsoon / fog cloud
    this.sky.cloudDensity.value = W.density;
    this.envSky.cloudCoverage.value = 0; // reflections don't need the (expensive) raymarched clouds
    this.envSky.cloudDensity.value = 0;
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.starMat.opacity = this.night * (weatherKey === 'CLEAR' ? 0.95 : weatherKey === 'FOG' ? 0 : 0.25);
    this.cloudGroup.visible = weatherKey !== 'FOG';
    this.horizon.position.set(camera.position.x, focus.y, camera.position.z);
    this._updateClouds(dt, camera, W, golden, day, weatherKey);

    // sun & moon (shadow frustum snapped to texels to avoid shimmering)
    const sunCol = new THREE.Color().setRGB(1, 0.93 - golden * 0.25, 0.84 - golden * 0.45);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 2.5 * day * W.sun;
    const lightDir = this.sunDir.y > 0.02 ? this.sunDir : new THREE.Vector3(this.sunDir.x, 0.05, this.sunDir.z).normalize();
    const texel = 340 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, focus.y, fz);
    this.sun.position.set(fx + lightDir.x * 450, focus.y + lightDir.y * 450, fz + lightDir.z * 450);
    this.moon.intensity = 0.5 * this.night * (weatherKey === 'CLEAR' ? 1 : weatherKey === 'FOG' ? 0.15 : 0.4);
    this.moon.position.set(focus.x - 200, focus.y + 300, focus.z + 120);
    this.moon.target.position.copy(focus);
    this.hemi.intensity = 0.12 + 0.3 * day;
    this.hemi.color.setRGB(0.55 + 0.25 * day, 0.62 + 0.25 * day, 0.85);
    this.hemi.groundColor.setRGB(0.25 + 0.15 * day, 0.2 + 0.1 * day, 0.15);

    // fog matches the horizon tone, with distinct dawn / evening / night palettes
    const elevDegNow = Math.asin(this.sunDir.y) * 57.3;
    const morning = this.sunDir.x > 0;
    const pal = {
      night: [0.028, 0.04, 0.085],
      twilightM: [0.42, 0.36, 0.42], twilightE: [0.48, 0.3, 0.3],
      goldenM: [0.92, 0.72, 0.56], goldenE: [0.95, 0.6, 0.38],
      day: [0.74, 0.8, 0.86]
    };
    const lerp3 = (a, b, k) => [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * k);
    let base;
    if (elevDegNow < -8) base = pal.night;
    else if (elevDegNow < -1) base = lerp3(pal.night, morning ? pal.twilightM : pal.twilightE, (elevDegNow + 8) / 7);
    else if (elevDegNow < 8) base = lerp3(morning ? pal.twilightM : pal.twilightE, morning ? pal.goldenM : pal.goldenE, (elevDegNow + 1) / 9);
    else if (elevDegNow < 25) base = lerp3(morning ? pal.goldenM : pal.goldenE, pal.day, (elevDegNow - 8) / 17);
    else base = pal.day;
    let f = base.map((v, i) => v * W.fogTint[i]);
    if (weatherKey === 'FOG') {
      // winter fog: milky, glowing warm at dawn, steel-blue at night, thickest around sunrise
      // day: soft milky grey; dawn/dusk: faint warm glow; night: deep blue-grey murk
      const dayMilk = [0.8, 0.81, 0.83], warm = morning ? [0.8, 0.72, 0.64] : [0.74, 0.64, 0.6], nightMilk = [0.05, 0.056, 0.072];
      const tw = Math.max(0, 1 - Math.abs(elevDegNow - 3) / 12);
      let milk = lerp3(dayMilk, warm, tw * 0.7);
      milk = lerp3(milk, nightMilk, THREE.MathUtils.smoothstep(-elevDegNow, -2, 9));
      f = milk;
    }
    this.scene.fog.color.setRGB(f[0], f[1], f[2]);
    const fogBoost = weatherKey === 'FOG' ? (elevDegNow < 12 && morning ? 1.35 : this.night > 0.5 ? 1.2 : 1) : 1;
    this.scene.fog.density = W.fog * fogBoost;
    this.nightDome.position.copy(camera.position);
    // only deep night gets the blue dome; twilight keeps the coloured physical sky
    const deepNight = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, -0.24, -0.07);
    this.nightMat.opacity = Math.min(0.92, deepNight * (weatherKey === 'FOG' ? 0.6 : 1));
    this.fogDome.position.copy(camera.position);
    this.fogDomeMat.color.setRGB(f[0], f[1], f[2]);
    this.fogDomeMat.opacity = weatherKey === 'FOG' ? 1 : weatherKey === 'MONSOON' ? 0.45 : weatherKey === 'HAZE' ? 0.22 : 0;
    // sun colour: deep orange near the horizon, moonlight bluish at night
    const low = 1 - THREE.MathUtils.smoothstep(this.sunDir.y, 0.0, 0.3);
    this.sun.color.setRGB(1, 0.94 - low * 0.38, 0.86 - low * 0.62);
    this.hemi.color.setRGB(0.45 + 0.35 * day + golden * 0.15, 0.5 + 0.32 * day, 0.75 + 0.1 * day - golden * 0.1);
    this.hemi.groundColor.setRGB(0.18 + 0.2 * day + golden * 0.1, 0.14 + 0.12 * day, 0.11 + 0.06 * day);
    this.hemi.intensity = 0.1 + 0.32 * day + this.night * 0.12;
    this.moon.color.setRGB(0.55, 0.65, 1.0);

    // nights stay dark (less exposure lift); fog is dim and flat, not glowing
    this.renderer.toneMappingExposure = (0.48 + 0.12 * golden + 0.3 * this.night) * (weatherKey === 'FOG' ? 0.86 : 1);

    // Re-bake reflections only when the lighting phase or weather changes: a PMREM
    // bake renders a full cube + blur and would otherwise hitch the frame rate.
    const elevDeg = Math.asin(this.sunDir.y) * 57.3;
    const phase = elevDeg < -4 ? 'night' : elevDeg < 6 ? 'twilight' : elevDeg < 22 ? 'low' : 'day';
    const side = this.sunDir.x > 0 ? 'E' : 'W';
    const key = `${weatherKey}|${phase}|${phase === 'low' || phase === 'twilight' ? side : ''}`;
    if (key !== this.lastEnvKey) {
      this.lastEnvKey = key;
      if (this.hdr) {
        this.scene.environment = this.hdr;
      } else {
        const rt = this.pmrem.fromScene(this.envScene, 0, 0.1, 100, this.envRT ? { renderTarget: this.envRT } : {});
        this.envRT = rt;
        this.scene.environment = rt.texture;
      }
    }
    this.scene.environmentIntensity = 0.06 + 0.32 * day;
    this.horizonMat.color.setScalar(0.12 + 0.88 * day);
    return { night: this.night, day };
  }
}
