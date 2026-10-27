// 三维场景构建：地形、天空、道路、水面、建筑、树木、光照
import * as THREE from "three";
import { KIND_INFO } from "./data.js";
import { buildDetailed } from "./models.js";

const WINDOW_W = 5.6;   // 一面窗的横向节奏（米）
const WINDOW_H = 3.7;   // 层高节奏（米）

/* ------------------------------------------------------------ 贴图 */
function wallTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#f4f2ee";
  g.fillRect(0, 0, 128, 128);
  const grd = g.createLinearGradient(0, 0, 0, 128);
  grd.addColorStop(0, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(196,192,184,0.35)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#5d6b7d";
  g.fillRect(26, 34, 76, 54);
  g.fillStyle = "#8fa2b8";
  g.fillRect(28, 36, 72, 22);
  g.strokeStyle = "rgba(240,238,232,0.9)";
  g.lineWidth = 4;
  g.strokeRect(26, 34, 76, 54);
  g.beginPath();
  g.moveTo(64, 34); g.lineTo(64, 88);
  g.stroke();
  g.fillStyle = "rgba(150,146,138,0.55)";
  g.fillRect(0, 116, 128, 6);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / WINDOW_W, 1 / WINDOW_H);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function windowGlowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#000";
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = "#fff";
  g.fillRect(28, 36, 72, 50);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / WINDOW_W, 1 / WINDOW_H);
  return t;
}

function grassTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  g.fillStyle = "#798f61";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const l = 0.30 + Math.random() * 0.22;
    g.fillStyle = `hsla(${94 + Math.random() * 26}, ${22 + Math.random() * 20}%, ${l * 100}%, ${0.25 + Math.random() * 0.35})`;
    g.fillRect(x, y, 1 + Math.random() * 2.4, 1 + Math.random() * 2.4);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / 26, 1 / 26);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ------------------------------------------------------------ 天空 */
function buildSky() {
  const geo = new THREE.SphereGeometry(7200, 32, 18);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      cTop: { value: new THREE.Color("#7fa9d2") },
      cMid: { value: new THREE.Color("#cfe0ee") },
      cBot: { value: new THREE.Color("#e9eef0") },
    },
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform vec3 cTop; uniform vec3 cMid; uniform vec3 cBot; varying vec3 vP;
      void main(){
        float h = clamp(normalize(vP).y, -1.0, 1.0);
        vec3 col = h > 0.06
          ? mix(cMid, cTop, pow(smoothstep(0.06, 1.0, h), 0.8))
          : mix(cBot, cMid, smoothstep(-0.35, 0.06, h));
        gl_FragColor = vec4(col, 1.0);
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const m = new THREE.Mesh(geo, mat);
  m.frustumCulled = false;
  return m;
}

/* ------------------------------------------------------------ 基础几何 */
function shapeFromPoly(poly) {
  const s = new THREE.Shape();
  poly.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  return s;
}

/* 地形采样器（米，世界 y = 高程 - datum） */
export function makeTerrain(terr, datum) {
  const { res, minX, minZ, nx, nz, h } = terr;
  const at = (i, j) => h[j * nx + i];
  const fn = (x, z) => {
    let gx = (x - minX) / res, gz = (z - minZ) / res;
    gx = Math.min(Math.max(gx, 0), nx - 1.001);
    gz = Math.min(Math.max(gz, 0), nz - 1.001);
    const i0 = Math.floor(gx), j0 = Math.floor(gz);
    const fx = gx - i0, fz = gz - j0;
    const h00 = at(i0, j0), h10 = at(i0 + 1, j0);
    const h01 = at(i0, j0 + 1), h11 = at(i0 + 1, j0 + 1);
    const top = h00 * (1 - fx) + h10 * fx;
    const bot = h01 * (1 - fx) + h11 * fx;
    return top * (1 - fz) + bot * fz - datum;
  };
  fn.grid = { res, minX, minZ, nx, nz, h };
  fn.raw = (x, z) => fn(x, z) + datum;
  return fn;
}

/* 沿地形起伏的平面多边形（草地、场地、水面用） */
function drapedMesh(poly, color, H, lift, opts = {}) {
  const geo = new THREE.ShapeGeometry(shapeFromPoly(poly));
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, H(pos.getX(i), pos.getZ(i)) + lift);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: opts.roughness ?? 0.95, metalness: 0,
    transparent: opts.opacity != null, opacity: opts.opacity ?? 1,
    side: THREE.DoubleSide, depthWrite: opts.opacity == null,
  });
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  return m;
}

/* 沿地形起伏的道路带状几何 */
/* 阶梯：沿折线按踏步长度切分，每级一块水平踏面 + 一块竖直踢面，
   坡道上看起来就是真楼梯；台阶路强制走这条分支，普通路坡度 > 14% 也自动成阶。*/
function stairGeometry(road, H, lift = 0.30) {
  const pos = [];
  const half = road.w / 2;
  const RUN = 1.15;          // 踏面进深（米）
  const MAX_RISE = 0.34;     // 单级最大升高

  // 先按 RUN 采样整条折线，得到一串 [x, z, y]
  const nodes = [];
  for (let i = 0; i < road.pts.length - 1; i++) {
    const [x1, z1] = road.pts[i];
    const [x2, z2] = road.pts[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const n = Math.max(1, Math.round(len / RUN));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = x1 + (x2 - x1) * t;
      const z = z1 + (z2 - z1) * t;
      nodes.push([x, z, H(x, z) + lift]);
    }
  }
  const last = road.pts[road.pts.length - 1];
  nodes.push([last[0], last[1], H(last[0], last[1]) + lift]);
  if (nodes.length < 2) return null;

  // 逐级抬高，做出台阶的「阶梯感」
  for (let i = 0; i < nodes.length - 1; i++) {
    const [x1, z1, y1] = nodes[i];
    const [x2, z2, y2] = nodes[i + 1];
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * half, nz = (dx / len) * half;
    const yTop = Math.max(y1, y2);
    const yBot = Math.min(y1, y2);
    const rise = yTop - yBot;
    const steps = Math.max(1, Math.min(6, Math.round(rise / MAX_RISE)));
    for (let sIdx = 0; sIdx < steps; sIdx++) {
      const t0 = sIdx / steps, t1 = (sIdx + 1) / steps;
      const ax = x1 + dx * t0, az = z1 + dz * t0;
      const bx = x1 + dx * t1, bz = z1 + dz * t1;
      const y = yBot + (rise * (sIdx + 1)) / steps;
      // 踏面
      pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
      pos.push(ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
      // 踢面（防止侧面漏光）
      if (sIdx > 0) {
        const yPrev = yBot + (rise * sIdx) / steps;
        pos.push(ax + nx, y, az + nz, ax + nx, yPrev, az + nz, ax - nx, yPrev, az - nz);
        pos.push(ax + nx, y, az + nz, ax - nx, yPrev, az - nz, ax - nx, y, az - nz);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

function roadGeometry(road, H, lift = 0.26) {
  const pos = [];
  const half = road.w / 2;
  const yOf = (x, z) => H(x, z) + lift;

  // 自适应细分：地形与直线插值差超过 0.7 m 就继续劈，避免长直段悬空
  const pts = [];
  const walk = (x1, z1, x2, z2, depth) => {
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const gap = Math.hypot(x2 - x1, z2 - z1);
    const mid = H(mx, mz) + lift;
    const lin = (yOf(x1, z1) + yOf(x2, z2)) / 2;
    if (depth < 5 && (gap > 6 || Math.abs(mid - lin) > 0.7)) {
      walk(x1, z1, mx, mz, depth + 1);
      walk(mx, mz, x2, z2, depth + 1);
    } else {
      pts.push([x2, z2]);
    }
  };
  const src = road.pts;
  if (!src.length) return null;
  pts.push([src[0][0], src[0][1]]);
  for (let i = 0; i < src.length - 1; i++) {
    walk(src[i][0], src[i][1], src[i + 1][0], src[i + 1][1], 0);
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[i + 1];
    const dx = x2 - x1, dz = z2 - z1;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * half, nz = (dx / len) * half;
    const a = [x1 + nx, z1 + nz], b = [x2 + nx, z2 + nz];
    const c = [x2 - nx, z2 - nz], d = [x1 - nx, z1 - nz];
    pos.push(a[0], yOf(a[0], a[1]), a[1], b[0], yOf(b[0], b[1]), b[1], c[0], yOf(c[0], c[1]), c[1]);
    pos.push(a[0], yOf(a[0], a[1]), a[1], c[0], yOf(c[0], c[1]), c[1], d[0], yOf(d[0], d[1]), d[1]);
  }
  const seg = 8;
  for (const [x, z] of pts) {
    const y = yOf(x, z);
    for (let s = 0; s < seg; s++) {
      const a0 = (s / seg) * Math.PI * 2, a1 = ((s + 1) / seg) * Math.PI * 2;
      pos.push(x, y, z);
      pos.push(x + Math.cos(a0) * half, y, z + Math.sin(a0) * half);
      pos.push(x + Math.cos(a1) * half, y, z + Math.sin(a1) * half);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------ 地形网格 */
function buildTerrainMesh(terr, datum, tex, ground, groundTex, boundary) {
  const { res, minX, minZ, nx, nz, h } = terr;
  const count = nx * nz;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const uv = ground ? new Float32Array(count * 2) : null;
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);

  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < h.length; i++) {
    if (h[i] < hMin) hMin = h[i];
    if (h[i] > hMax) hMax = h[i];
  }
  const span = Math.max(1, hMax - hMin);
  const cLow = new THREE.Color("#6a8355");
  const cHigh = new THREE.Color("#8fa06b");
  const cSteep = new THREE.Color("#8a7f63");
  const tmp = new THREE.Color();

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i;
      const x = minX + i * res;
      const z = minZ + j * res;
      pos[k * 3] = x;
      pos[k * 3 + 1] = h[k] - datum;
      pos[k * 3 + 2] = z;
      if (uv) {
        uv[k * 2] = (x - ground.minX) / (ground.maxX - ground.minX);
        uv[k * 2 + 1] = (ground.maxZ - z) / (ground.maxZ - ground.minZ);
      }

      // 坡度（相邻高程差）
      const hx = h[j * nx + Math.min(i + 1, nx - 1)] - h[j * nx + Math.max(i - 1, 0)];
      const hz = h[Math.min(j + 1, nz - 1) * nx + i] - h[Math.max(j - 1, 0) * nx + i];
      const slope = Math.min(1, Math.hypot(hx, hz) / (res * 2) / 0.45);
      const t = (h[k] - hMin) / span;
      tmp.copy(cLow).lerp(cHigh, t * 0.85).lerp(cSteep, slope * 0.55);
      if (groundTex) {
        // 有卫星底图：顶点色只当「蒙版」用 —— 校外压暗去饱和，视线自然回到校园
        const out = boundary && !insidePoly(x, z, boundary, 0) ? 1 : 0;
        if (out) tmp.setRGB(0.62, 0.66, 0.60); else tmp.setRGB(1, 1, 1);
      }
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    }
  }
  let p = 0;
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b;
      idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  if (uv) geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();

  const matColor = new THREE.MeshStandardMaterial({ vertexColors: true, map: tex, roughness: 1, metalness: 0 });
  const matSat = groundTex
    ? new THREE.MeshStandardMaterial({ map: groundTex, vertexColors: true, roughness: 1, metalness: 0 })
    : null;
  const mat = matSat && SAT_DEFAULT ? matSat : matColor;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return { mesh, hMin, hMax, matColor, matSat };
}

function insidePoly(x, z, poly, pad = 0) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  if (!inside && pad > 0) {
    // 描边外扩一圈，避免水岸出现台阶
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const px = ax + dx * t - x, pz = az + dz * t - z;
      if (px * px + pz * pz < pad * pad) return true;
    }
  }
  return inside;
}

// 水面网格：只在水域多边形内、且地形低于水面的格子铺面片
function waterGrid(poly, surface, H, step) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  poly.forEach(([x, z]) => {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  });
  const pos = [];
  const inPoly = (x, z) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], zi = poly[i][1];
      const xj = poly[j][0], zj = poly[j][1];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  for (let z = minZ; z < maxZ; z += step) {
    for (let x = minX; x < maxX; x += step) {
      const cx = x + step / 2, cz = z + step / 2;
      if (!inPoly(cx, cz)) continue;
      if (H(cx, cz) > surface - 0.12) continue;
      pos.push(x, surface, z, x, surface, z + step, x + step, surface, z + step);
      pos.push(x, surface, z, x + step, surface, z + step, x + step, surface, z);
    }
  }
  if (!pos.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.computeVertexNormals();
  return geo;
}

/* ------------------------------------------------------------ 主构建 */
const SAT_DEFAULT = /(^|[?&])sat(=|&|$)/.test(location.search);
const DBG = new Set((new URLSearchParams(location.search).get('dbg') || '').split(',').filter(Boolean));

export function buildWorld(data) {
  const root = new THREE.Group();
  const b = data.meta.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;

  const terr = data.terrain;
  let rawMin = Infinity;
  for (let i = 0; i < terr.h.length; i++) if (terr.h[i] < rawMin) rawMin = terr.h[i];
  // 卫星底图：地面直接用真实影像（操场/道路/绿地/湖全都对得上）
  const ground = data.meta && data.meta.ground;
  let groundTex = null;
  if (ground) {
    const src = (typeof window !== "undefined" && window.__SAT__) || ground.url;
    groundTex = new THREE.TextureLoader().load(src);
    groundTex.colorSpace = THREE.SRGBColorSpace;
    groundTex.anisotropy = 8;
  }
  const satMode = !!groundTex && SAT_DEFAULT;

  const datum = rawMin - 6;                    // 世界 y 的零点

  // 先把水面、运动场做成台地：内部抬/压平，边缘 20~30 m 平滑过渡
  const src = makeTerrain(terr, datum);
  const carved = Float64Array.from(terr.h);
  const { res, minX, minZ, nx, nz } = terr;

  const distToPoly = (x, z, poly) => {
    if (insidePoly(x, z, poly, 0)) return 0;
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const [ax, az] = poly[i];
      const [bx, bz] = poly[(i + 1) % poly.length];
      const dx = bx - ax, dz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      const px = ax + dx * t - x, pz = az + dz * t - z;
      const d = px * px + pz * pz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };

  const carvePoly = (poly, level, blend, maxCut = 2.0, maxFill = 1.4) => {
    let pminX = Infinity, pmaxX = -Infinity, pminZ = Infinity, pmaxZ = -Infinity;
    poly.forEach(([x, z]) => {
      pminX = Math.min(pminX, x); pmaxX = Math.max(pmaxX, x);
      pminZ = Math.min(pminZ, z); pmaxZ = Math.max(pmaxZ, z);
    });
    const i0 = Math.max(0, Math.floor((pminX - blend * 1.6 - minX) / res));
    const i1 = Math.min(nx - 1, Math.ceil((pmaxX + blend * 1.6 - minX) / res));
    const j0 = Math.max(0, Math.floor((pminZ - blend * 1.6 - minZ) / res));
    const j1 = Math.min(nz - 1, Math.ceil((pmaxZ + blend * 1.6 - minZ) / res));
    for (let j = j0; j <= j1; j++) {
      const z = minZ + j * res;
      for (let i = i0; i <= i1; i++) {
        const x = minX + i * res;
        const d = distToPoly(x, z, poly);
        if (d > blend) continue;
        const k = j * nx + i;
        const t = Math.min(1, Math.max(0, 1 - d / blend));
        const w = t * t * (3 - 2 * t);           // smoothstep
        // 只允许有限挖填：否则 30 m SRTM 会把上坡侧削出十几米的假坑
        const tgt = Math.min(Math.max(carved[k], level - maxCut), level + maxFill);
        carved[k] = carved[k] * (1 - w) + tgt * w;
      }
    }
  };

  // 只挖「贴着水面的一圈岸」，比水面高出一截的坡体保持原样，避免整块被削成坑
  const carveShallow = (poly, level, blend, depth, band) => {
    let pminX = Infinity, pmaxX = -Infinity, pminZ = Infinity, pmaxZ = -Infinity;
    poly.forEach(([x, z]) => {
      pminX = Math.min(pminX, x); pmaxX = Math.max(pmaxX, x);
      pminZ = Math.min(pminZ, z); pmaxZ = Math.max(pmaxZ, z);
    });
    const i0 = Math.max(0, Math.floor((pminX - blend - minX) / res));
    const i1 = Math.min(nx - 1, Math.ceil((pmaxX + blend - minX) / res));
    const j0 = Math.max(0, Math.floor((pminZ - blend - minZ) / res));
    const j1 = Math.min(nz - 1, Math.ceil((pmaxZ + blend - minZ) / res));
    for (let j = j0; j <= j1; j++) {
      const z = minZ + j * res;
      for (let i = i0; i <= i1; i++) {
        const x = minX + i * res;
        const k = j * nx + i;
        const base = carved[k];
        if (base > level + band) continue;         // 高坡不动
        const d = distToPoly(x, z, poly);
        const t = Math.min(1, Math.max(0, 1 - d / blend));
        const w = t * t * (3 - 2 * t);
        const tgt = Math.min(base, level - depth);
        carved[k] = base * (1 - w) + tgt * w;
      }
    }
  };

  const insideHeights = (poly) => {
    const vals = [];
    let pminX = Infinity, pmaxX = -Infinity, pminZ = Infinity, pmaxZ = -Infinity;
    poly.forEach(([x, z]) => {
      pminX = Math.min(pminX, x); pmaxX = Math.max(pmaxX, x);
      pminZ = Math.min(pminZ, z); pmaxZ = Math.max(pmaxZ, z);
    });
    const i0 = Math.max(0, Math.floor((pminX - minX) / res));
    const i1 = Math.min(nx - 1, Math.ceil((pmaxX - minX) / res));
    const j0 = Math.max(0, Math.floor((pminZ - minZ) / res));
    const j1 = Math.min(nz - 1, Math.ceil((pmaxZ - minZ) / res));
    for (let j = j0; j <= j1; j++) {
      const z = minZ + j * res;
      for (let i = i0; i <= i1; i++) {
        const x = minX + i * res;
        if (insidePoly(x, z, poly, 0)) vals.push(src(x, z));
      }
    }
    vals.sort((a, b) => a - b);
    return vals;
  };
  // 取中位数当水面/台地基准：用最低点会把上坡侧削成深坑
  const levelInside = (poly, delta = 0) => {
    const v = insideHeights(poly);
    if (!v.length) return src(poly[0][0], poly[0][1]) + delta;
    return v[Math.floor(v.length * 0.5)] + delta;
  };

  const waterLevels = new Map();
  data.water.forEach((w) => {
    // 不做地形削挖：SRTM 30 m 精度下削挖会留下台阶假坑。
    // 水面取水域内低处的分位高程，地形高的地方自然越过水面，就成了湖岸。
    const vs = insideHeights(w.poly);
    const pick = (q) => (vs.length ? vs[Math.min(vs.length - 1, Math.floor(vs.length * q))] : src(w.poly[0][0], w.poly[0][1]));
    const lv = pick(0.12) + 0.6;
    waterLevels.set(w, lv);
  });
  // 运动场不做削挖：填/挖超过 1 m 就会在 30 m DEM 上留下台地断崖。
  // 改成把场地网格逐点贴地渲染（坡度在 5% 以内，肉眼几乎看不出）。

  const terr2 = { ...terr, h: carved };
  const H = makeTerrain(terr2, datum);
  const centerY = H(cx, cz);

  /* 天空 / 地形 */
  const sky = buildSky();
  root.add(sky);
  const grassTex = grassTexture();
  const terrain = buildTerrainMesh(terr2, datum, grassTex, ground, groundTex, data.boundary);
  root.add(terrain.mesh);
  const terrainMesh = terrain.mesh;

  /* 远处接地的雾面（防止看到地形网格边缘） */
  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(14000, 14000),
    new THREE.MeshStandardMaterial({ color: "#7f9370", roughness: 1 })
  );
  far.rotation.x = -Math.PI / 2;
  far.position.set(cx, terrain.hMin - datum + 2, cz);
  root.add(far);

  /* 校园边界描边 */
  const boundaryLine = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      data.boundary.map(([x, z]) => new THREE.Vector3(x, H(x, z) + 0.6, z))
    ),
    new THREE.LineBasicMaterial({ color: "#f0e6c8", transparent: true, opacity: 0.35 })
  );
  root.add(boundaryLine);

  /* 绿地 */
  const green = new THREE.Group();
  data.greens.forEach((g) => green.add(drapedMesh(g.poly, "#4d7247", H, 0.18)));
  if (!satMode) root.add(green);

  /* 运动场地：底色 + 白线 */
  const pitchGroup = new THREE.Group();
  const pitchColors = {
    soccer: "#5c8b52", basketball: "#b8764e", tennis: "#4a7f74",
    volleyball: "#b08a52", generic: "#5f8459", running: "#b25c46",
  };
  data.pitches.forEach((p) => {
    const col = pitchColors[p.sport] || pitchColors.generic;
    pitchGroup.add(drapedMesh(p.poly, col, H, 0.24));
    const ring = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints(
        p.poly.map(([x, z]) => new THREE.Vector3(x, H(x, z) + 0.3, z))
      ),
      new THREE.LineBasicMaterial({ color: "#f4f6f1", transparent: true, opacity: 0.6 })
    );
    pitchGroup.add(ring);
  });
  if (!satMode && !DBG.has('np')) root.add(pitchGroup);

  /* 水面：同一片水域取固定水面高程 */
  const waterMat = new THREE.MeshStandardMaterial({
    color: "#2c6b90", roughness: 0.34, metalness: 0.0,
    transparent: true, opacity: 0.9,
    emissive: "#0d2a3d", emissiveIntensity: 0.55,
  });
  const waterGroup = new THREE.Group();
  data.water.forEach((w) => {
    const surface = (waterLevels.get(w) ?? levelInside(w.poly, 0.2)) + 0.1;
    const geo = waterGrid(w.poly, surface, H, 2);
    if (!geo) return;
    const m = new THREE.Mesh(geo, waterMat);
    m.receiveShadow = true;
    waterGroup.add(m);
  });
  if (!DBG.has('nw')) root.add(waterGroup);

  /* 道路 */
  // 有卫星底图时，路网只留一层淡淡的压印，避免和真实影像重叠成"双线"
  const ROAD_OPACITY = satMode ? 0.35 : 1;
  const roadMat = new THREE.MeshStandardMaterial({ color: "#83888c", roughness: 0.92, transparent: satMode, opacity: ROAD_OPACITY });
  const pathMat = new THREE.MeshStandardMaterial({ color: "#b9beb8", roughness: 0.95, transparent: satMode, opacity: satMode ? 0.30 : 1 });
  const roadGroup = new THREE.Group();
  data.roads.forEach((r) => {
    let ins = 0;
    r.pts.forEach(([x, z]) => { if (insidePoly(x, z, data.boundary, 10)) ins++; });
    if (ins / r.pts.length < 0.62) return;          // 城外市政路不画
    const mat = r.w >= 6 ? roadMat : pathMat;
    // 台阶路，或者坡度很陡的步行道 → 生成真实踏步
    let slope = 0, dist = 0;
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
      const d = Math.hypot(x2 - x1, z2 - z1) || 1;
      slope += Math.abs(H(x2, z2) - H(x1, z1));
      dist += d;
    }
    const isSteps = /台阶|steps/i.test(r.kind || "");
    const steep = dist > 12 && slope / dist > 0.14 && r.w <= 5;
    const geoRoad = (isSteps || steep) ? (stairGeometry(r, H) || roadGeometry(r, H)) : roadGeometry(r, H);
    const m = new THREE.Mesh(geoRoad, mat);
    m.receiveShadow = true;
    roadGroup.add(m);
  });
  if (!DBG.has('nr')) root.add(roadGroup);

  /* 建筑 */
  const wallTex = wallTexture();
  const glowTex = windowGlowTexture();
  const wallMats = {};
  const wallMatAll = [];
  Object.entries(KIND_INFO).forEach(([kind, info]) => {
    wallMats[kind] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(info.color),
      map: wallTex,
      roughness: 0.82,
      metalness: 0.02,
      emissive: new THREE.Color("#ffcf8a"),
      emissiveMap: glowTex,
      emissiveIntensity: 0,
    });
  });
  const roofMat = new THREE.MeshStandardMaterial({ color: "#8d8a84", roughness: 0.95 });
  const roofMatDark = new THREE.MeshStandardMaterial({ color: "#6f6c67", roughness: 0.95 });
  const roofMats = [roofMat, roofMatDark,
    new THREE.MeshStandardMaterial({ color: "#7e7466", roughness: 0.95 }),
    new THREE.MeshStandardMaterial({ color: "#9a9187", roughness: 0.95 })];

  const edgeMat = new THREE.LineBasicMaterial({ color: 0x394038, transparent: true, opacity: 0.55 });
  const SKIRT = 7;      // 地基埋深，保证坡地上不悬空
  const buildings = new THREE.Group();
  const meshes = [];
  const pick = [];

  data.buildings.forEach((bd) => {
    // 楼基高度：取轮廓内最低点，向下埋 SKIRT
    let baseY = Infinity;
    for (const [x, z] of bd.poly) baseY = Math.min(baseY, H(x, z));
    for (const [x, z] of [bd.c, ...(bd.poly || [])]) baseY = Math.min(baseY, H(x, z));
    bd.baseY = baseY;

    // 有体积感的建模（裙房 / 内院 / 女儿墙）——不再是单块挤出
    if (!DBG.has('flat')) {
      const wallM = new THREE.MeshStandardMaterial({
        color: new THREE.Color(bd.wall || (KIND_INFO[bd.kind] || KIND_INFO.misc).color),
        map: wallTex, roughness: 0.82, metalness: 0.02,
        emissive: new THREE.Color("#ffcf8a"), emissiveMap: glowTex, emissiveIntensity: 0,
      });
      const dRes = buildDetailed(THREE, bd, baseY, {
        wall: wallM,
        roof: new THREE.MeshStandardMaterial({ color: new THREE.Color(bd.roof || "#8d8a84"), roughness: 0.95 }),
        trim: new THREE.MeshStandardMaterial({ color: new THREE.Color("#9d9a92"), roughness: 0.95 }),
      });
      dRes.walls.forEach((m) => wallMatAll.push(m));
      dRes.group.traverse((o) => {
        if (o.isMesh) { o.userData.id = bd.id; pick.push(o); }
      });
      buildings.add(dRes.group);
      meshes.push(dRes.group);
      return;
    }

    const shape = shapeFromPoly(bd.poly);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: bd.h + SKIRT, bevelEnabled: false, curveSegments: 1,
    });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, baseY - SKIRT, 0);
    geo.computeVertexNormals();

    // 配色：优先用卫星图采到的真实屋顶/立面色（campus.json 里 b.roof / b.wall）
    let wallMat;
    let roofMatUse = roofMats[bd.id % roofMats.length];
    if (bd.wall || bd.roof) {
      const baseWall = wallMats[bd.kind] || wallMats.misc;
      wallMat = baseWall.clone();
      if (bd.wall) wallMat.color = new THREE.Color(bd.wall);
      if (bd.roof) {
        roofMatUse = roofMat.clone();
        roofMatUse.color = new THREE.Color(bd.roof);
      }
    } else {
      const baseWall = wallMats[bd.kind] || wallMats.misc;
      const jitter = 0.94 + ((bd.id * 37) % 13) / 13 * 0.12;
      wallMat = baseWall.clone();
      wallMat.color.multiplyScalar(jitter);
    }
    wallMatAll.push(wallMat);
    const mesh = new THREE.Mesh(geo, [roofMatUse, wallMat]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.id = bd.id;
    buildings.add(mesh);

    // 屋顶轮廓线：让体量和屋脊在俯视/斜视时都清楚一点
    const ring = [];
    bd.poly.forEach(([x, z]) => ring.push(new THREE.Vector3(x, baseY + bd.h + 0.05, z)));
    if (ring.length > 2) {
      const lg = new THREE.BufferGeometry().setFromPoints([...ring, ring[0]]);
      const line = new THREE.Line(lg, edgeMat);
      line.renderOrder = 2;
      buildings.add(line);
    }
    meshes.push(mesh);
    pick.push(mesh);

    // 屋顶设备
    if (bd.area > 1400 && bd.h > 8) {
      const [bcx, bcz] = bd.c;
      const w = Math.min(bd.bbox.maxX - bd.bbox.minX, bd.bbox.maxZ - bd.bbox.minZ);
      const n = bd.area > 6000 ? 3 : bd.area > 2800 ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const s = THREE.MathUtils.clamp(w * (0.16 + 0.06 * k), 2.2, 9);
        const box = new THREE.Mesh(new THREE.BoxGeometry(s, 1.4 + k * 0.6, s * 0.8), roofMatDark);
        box.position.set(
          bcx + (Math.sin(bd.id + k * 2.1) * w) / 5,
          baseY + bd.h + 0.7 + k * 0.5,
          bcz + (Math.cos(bd.id + k * 1.7) * w) / 5
        );
        box.castShadow = true;
        buildings.add(box);
      }
    }
  });
  root.add(buildings);

  /* 树木 */
  const trees = new THREE.Group();
  const treeData = (data.trees || []).slice();
  {
    // 校园外侧的坡地上补一批野生树，山体才有纵深
    const bx0 = b.minX + 40, bx1 = b.maxX - 40, bz0 = b.minZ + 40, bz1 = b.maxZ - 40;
    let guard = 0;
    let added = 0;
    while (added < 900 && guard < 20000) {
      guard++;
      const x = bx0 + Math.random() * (bx1 - bx0);
      const z = bz0 + Math.random() * (bz1 - bz0);
      if (insidePoly(x, z, data.boundary, 12)) continue;     // 校园内交给原有树
      if (data.water.some((w) => insidePoly(x, z, w.poly, 4))) continue;
      treeData.push([x, z, 0.75 + Math.random() * 0.75]);
      added++;
    }
  }
  if (treeData.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 3.4, 5);
    trunkGeo.translate(0, 1.7, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1.9, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: "#6b5541", roughness: 1 });
    const crownMat = new THREE.MeshStandardMaterial({ color: "#3f7a45", roughness: 0.95, flatShading: true });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeData.length);
    const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeData.length);
    trunks.castShadow = crowns.castShadow = true;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    treeData.forEach((t, i) => {
      const [x, z, s] = t;
      const gy = H(x, z);
      const rot = (i * 2.399) % (Math.PI * 2);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot);
      m.compose(new THREE.Vector3(x, gy, z), q, new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, gy + 3.2 * s + 0.9 * s, z), q, new THREE.Vector3(s * 1.05, s * 1.15, s * 1.05));
      crowns.setMatrixAt(i, m);
      col.setHSL(0.28 + ((i * 37) % 100) / 100 * 0.05, 0.32 + ((i * 17) % 40) / 100, 0.28 + ((i * 53) % 30) / 100);
      crowns.setColorAt(i, col);
    });
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    trees.add(trunks, crowns);
  }
  if (!DBG.has('nt')) root.add(trees);

  /* 光照 */
  const hemi = new THREE.HemisphereLight("#cfe3f5", "#43503d", 0.75);
  const sun = new THREE.DirectionalLight("#fff1d8", 2.1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(3072, 3072);
  const s = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) * 0.6;
  Object.assign(sun.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 1, far: 7000 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.9;
  sun.target.position.set(cx, centerY, cz);
  root.add(hemi, sun, sun.target);
  const fill = new THREE.AmbientLight("#dfe9f5", 0.35);
  root.add(fill);

  return {
    root, sun, hemi, fill, sky, grassTex, terrainMesh, terrain: terr2, H, datum, centerY,
    buildings, trees, roadGroup, green, waterGroup, pitchGroup, matColor: terrain.matColor, matSat: terrain.matSat,
    meshes, pick, wallMats, wallMatAll, roofMat, roofMatDark, waterMat, roadMat, pathMat, boundaryLine,
    center: new THREE.Vector3(cx, centerY, cz),
    span: Math.max(b.maxX - b.minX, b.maxZ - b.minZ),
  };
}

/* ------------------------------------------------------------ 光影预设 */
export const PRESETS = {
  dawn: {
    label: "清晨", body: "",
    sun: { pos: [-0.65, 0.42, 0.48], color: "#ffd9b0", intensity: 1.5 },
    hemi: { sky: "#dfe9f7", ground: "#5b6552", intensity: 0.85 },
    amb: { color: "#eaf2fb", intensity: 0.4 },
    fog: { color: "#dfe8f1", near: 1100, far: 5200 },
    sky: ["#9dbcd8", "#e2ebf2", "#f0ece1"],
    windows: 0.25, exposure: 1.0,
  },
  day: {
    label: "日间", body: "",
    sun: { pos: [0.42, 0.92, 0.36], color: "#fff5e2", intensity: 2.5 },
    hemi: { sky: "#cfe3f5", ground: "#4d5942", intensity: 0.75 },
    amb: { color: "#e6eef7", intensity: 0.3 },
    fog: { color: "#cfe0ee", near: 1600, far: 6000 },
    sky: ["#6f9fd0", "#c3d9ea", "#e6eef1"],
    windows: 0, exposure: 1.0,
  },
  dusk: {
    label: "黄昏", body: "dusk",
    sun: { pos: [-0.88, 0.2, 0.42], color: "#ff9d5c", intensity: 1.9 },
    hemi: { sky: "#f6cdae", ground: "#4a3f3a", intensity: 0.62 },
    amb: { color: "#ffd7b8", intensity: 0.3 },
    fog: { color: "#e7b57f", near: 1100, far: 4800 },
    sky: ["#5f6f9e", "#e0a279", "#f3c99c"],
    windows: 0.6, exposure: 0.98,
  },
  night: {
    label: "夜间", body: "night",
    sun: { pos: [0.3, 0.62, -0.72], color: "#9fb8e8", intensity: 0.34 },
    hemi: { sky: "#2b3f60", ground: "#1a2433", intensity: 0.52 },
    amb: { color: "#58719c", intensity: 0.32 },
    fog: { color: "#101c2e", near: 900, far: 4200 },
    sky: ["#050a14", "#132238", "#243449"],
    windows: 1.15, exposure: 1.05,
  },
};

export function applyPreset(world, scene, renderer, key) {
  const p = PRESETS[key];
  document.body.classList.remove("night", "dusk");
  if (p.body) document.body.classList.add(p.body);
  const d = Math.max(world.span, 800);
  world.sun.position.set(
    world.center.x + p.sun.pos[0] * d,
    world.centerY + p.sun.pos[1] * d,
    world.center.z + p.sun.pos[2] * d
  );
  world.sun.color.set(p.sun.color);
  world.sun.intensity = p.sun.intensity;
  world.sun.target.position.set(world.center.x, world.centerY, world.center.z);
  world.hemi.color.set(p.hemi.sky);
  world.hemi.groundColor.set(p.hemi.ground);
  world.hemi.intensity = p.hemi.intensity;
  world.fill.color.set(p.amb.color);
  world.fill.intensity = p.amb.intensity;
  if (world.sky && p.sky) {
    world.sky.material.uniforms.cTop.value.set(p.sky[0]);
    world.sky.material.uniforms.cMid.value.set(p.sky[1]);
    world.sky.material.uniforms.cBot.value.set(p.sky[2]);
  }
  const fog = scene.fog || new THREE.Fog(p.fog.color, p.fog.near, p.fog.far);
  fog.color.set(p.fog.color);
  fog.near = p.fog.near;
  fog.far = p.fog.far;
  scene.fog = fog;
  (world.wallMatAll || Object.values(world.wallMats)).forEach((m) => { m.emissiveIntensity = p.windows; });
  renderer.toneMappingExposure = p.exposure;
  world.waterMat.color.set(key === "night" ? "#1b3d55" : key === "dusk" ? "#3d6a86" : "#2f6f96");
  return p;
}
