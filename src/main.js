// 入口：相机 / 交互 / UI 绑定
import * as THREE from "three";
import { OrbitControls } from "three/addons/OrbitControls.js";
import { loadCampus, KIND_INFO, KIND_ORDER, pointInPoly, fmtArea } from "./data.js";
import { buildWorld, applyPreset, PRESETS } from "./scene.js";

const $ = (s) => document.querySelector(s);
const app = $("#app");

const state = {
  data: null, world: null, preset: "day",
  selectedId: null, walking: false, showLabels: true,
  yaw: 0, pitch: 0, velocity: new THREE.Vector3(),
};

/* ---------------------------------------------------------- 渲染器 */
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(46, innerWidth / innerHeight, 1, 9000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 45;
controls.maxDistance = 2600;
controls.maxPolarAngle = Math.PI * 0.487;
controls.screenSpacePanning = false;

/* ---------------------------------------------------------- 视觉居中（左侧面板补偿） */
function shiftForPanel() {
  if (innerWidth <= 900) return;
  const panelW = $("#panel")?.getBoundingClientRect().width || 300;
  const dist = camera.position.distanceTo(controls.target);
  const mPerPx = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / innerHeight;
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
  const shift = right.multiplyScalar(-panelW * 0.5 * mPerPx);
  camera.position.add(shift);
  controls.target.add(shift);
}

/* ---------------------------------------------------------- 启动 */
const loaderEl = $("#loader");
loadCampus().then((data) => {
  state.data = data;
  const world = buildWorld(data);
  state.world = world;
  scene.add(world.root);

  applyPreset(world, scene, renderer, state.preset);
  const c = world.center;
  camera.position.set(c.x + world.span * 0.30, c.y + world.span * 0.40, c.z + world.span * 0.78);
  // 预览/分享用：?cam=距离,俯仰角,方位角（米/度/度）
  const camQ = new URLSearchParams(location.search).get("cam");
  if (camQ) {
    const [d, pol, azi] = camQ.split(",").map(Number);
    if (d > 0) {
      const phi = ((pol ?? 55) * Math.PI) / 180;
      const theta = ((azi ?? 35) * Math.PI) / 180;
      camera.position.set(
        c.x + d * Math.sin(phi) * Math.sin(theta),
        c.y + d * Math.cos(phi),
        c.z + d * Math.sin(phi) * Math.cos(theta)
      );
    }
  }
  controls.target.copy(c);
  controls.update();
  shiftForPanel();

  // 分享链接：#night / #top / #id=123
  const hash = location.hash.slice(1);
  if (hash) {
    hash.split("&").forEach((kv) => {
      const [k, v] = kv.split("=");
      if (k === "night" || k === "dusk" || k === "dawn" || k === "day") {
        state.preset = k;
        btnTime.textContent = applyPreset(world, scene, renderer, k).label;
      }
      if (k === "top") {
        camera.position.set(c.x + 1, c.y + world.span * 1.02, c.z + 1);
        controls.update();
      }
      if (k === "id") setTimeout(() => select(Number(v), true), 300);
    });
    if (hash === "top") {
      camera.position.set(c.x + 1, c.y + world.span * 1.02, c.z + 1);
      controls.update();
    }
  }

  buildList(data);
  buildLabels(data, world);
  if (innerWidth <= 860) $("#panel").classList.add("folded"), ($("#panel-fold").textContent = "+");
  drawMinimapBase(data);
  updateStats();
  requestAnimationFrame(() => loaderEl.classList.add("done"));
  animate();
}).catch((err) => {
  loaderEl.innerHTML = '<span style="color:#c0483f">加载失败：' + err.message + "</span>";
  console.error(err);
});

/* ---------------------------------------------------------- 侧栏列表 */
const listEl = $("#list");
const searchEl = $("#search");
const groups = new Map();

function buildList(data) {
  const folded = new Set();
  listEl.innerHTML = "";
  groups.clear();
  KIND_ORDER.forEach((kind) => {
    const items = data.buildings
      .filter((b) => b.kind === kind && b.name)
      .sort((a, b) => b.area - a.area);
    if (!items.length) return;
    const wrap = document.createElement("div");
    const head = document.createElement("button");
    head.className = "group-head";
    head.innerHTML = `<span class="dot" style="background:${KIND_INFO[kind].listColor}"></span>${KIND_INFO[kind].label}<span class="cnt">${items.length}</span>`;
    head.onclick = () => {
      wrap.classList.toggle("folded");
      if (wrap.classList.contains("folded")) folded.add(kind); else folded.delete(kind);
      wrap.querySelector(".items").style.display = wrap.classList.contains("folded") ? "none" : "";
    };
    const body = document.createElement("div");
    body.className = "items";
    items.forEach((b) => {
      const el = document.createElement("button");
      el.className = "item";
      el.dataset.id = b.id;
      el.dataset.search = (b.name + " " + KIND_INFO[kind].label).toLowerCase();
      el.innerHTML = `<span class="nm">${b.name}</span><span class="lv">${b.h.toFixed(0)}m</span>`;
      el.onclick = () => select(b.id, true);
      body.appendChild(el);
    });
    wrap.appendChild(head);
    wrap.appendChild(body);
    listEl.appendChild(wrap);
    groups.set(kind, wrap);
  });
}

searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim().toLowerCase();
  listEl.querySelectorAll(".item").forEach((el) => {
    el.style.display = !q || el.dataset.search.includes(q) ? "" : "none";
  });
  listEl.querySelectorAll(".group-head").forEach((head) => {
    const body = head.nextElementSibling;
    const any = [...body.children].some((c) => c.style.display !== "none");
    head.parentElement.style.display = any ? "" : "none";
  });
});

/* ---------------------------------------------------------- 选中与信息卡 */
const infoEl = $("#info");

function select(id, fly = false) {
  state.selectedId = id;
  const b = state.data.byId.get(id);
  listEl.querySelectorAll(".item").forEach((el) => el.classList.toggle("active", el.dataset.id === String(id)));
  if (!b) return;
  const info = KIND_INFO[b.kind];
  $("#info-title").textContent = b.landmark?.title || b.name || "未命名建筑";
  $("#info-tags").innerHTML = [
    `<span style="background:${info.listColor}33">${info.label}</span>`,
    b.h >= 40 ? `<span>校园高层</span>` : "",
    b.landmark ? `<span>地标</span>` : "",
  ].join("");
  $("#info-desc").textContent =
    b.landmark?.desc ||
    `位于 A 区${b.kind === "dorm" ? "生活区" : "教学科研区"}，占地约 ${fmtArea(b.area)}，檐高约 ${b.h.toFixed(0)} 米。轮廓取自 OpenStreetMap，细节为示意。`;
  $("#info-facts").innerHTML = [
    ["分类", info.label],
    ["檐高", b.h.toFixed(0) + " m"],
    ["层数", b.lv ? b.lv + " 层" : "未标注"],
    ["占地", fmtArea(b.area)],
    ["坐标", b.c.map((v) => v.toFixed(0)).join(", ") + " m"],
  ].map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  infoEl.classList.remove("hidden");
  if (fly) flyTo(b);
}

$("#info-close").onclick = () => infoEl.classList.add("hidden");

function flyTo(b) {
  if (state.walking) return;
  const from = { pos: camera.position.clone(), target: controls.target.clone() };
  const dist = THREE.MathUtils.clamp(b.h * 5 + 130, 150, 460);
  const baseY = b.baseY ?? state.world.H(b.c[0], b.c[1]);
  const to = {
    target: new THREE.Vector3(b.c[0], baseY + Math.min(b.h * 0.45, 26), b.c[1]),
    pos: new THREE.Vector3(
      b.c[0] + dist * 0.62,
      baseY + b.h + dist * 0.55,
      b.c[1] + dist * 0.78
    ),
  };
  const t0 = performance.now();
  const dur = 900;
  (function step() {
    const k = Math.min(1, (performance.now() - t0) / dur);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    camera.position.lerpVectors(from.pos, to.pos, e);
    controls.target.lerpVectors(from.target, to.target, e);
    controls.update();
    if (k < 1) requestAnimationFrame(step);
  })();
}

/* ---------------------------------------------------------- 标签 */
const labelsEl = document.createElement("div");
labelsEl.id = "labels";
document.body.appendChild(labelsEl);
let labelNodes = [];

function buildLabels(data, world) {
  labelsEl.innerHTML = "";
  labelNodes = [];
  // 同名建筑只给面积最大的那栋挂标签，避免重复叠字
  const byName = new Map();
  data.buildings.filter((b) => b.name).forEach((b) => {
    const prev = byName.get(b.name);
    if (!prev || b.area > prev.area) byName.set(b.name, b);
  });
  byName.forEach((b) => {
      const el = document.createElement("div");
      el.className = "label" + (b.landmark || b.area > 3000 ? " major" : "");
      el.textContent = b.landmark?.title || b.name;
      el.onclick = () => select(b.id, true);
      el.style.pointerEvents = "auto";
      labelsEl.appendChild(el);
      labelNodes.push({ b, el, v: new THREE.Vector3(b.c[0], (b.baseY ?? 0) + b.h + 4, b.c[1]) });
    });
}

const tmpV = new THREE.Vector3();
function updateLabels() {
  if (!state.showLabels) {
    labelsEl.style.display = "none";
    return;
  }
  labelsEl.style.display = "";
  const camDist = camera.position.distanceTo(controls.target);
  const placed = [];
  const sorted = labelNodes
    .map((n) => ({ n, d: camera.position.distanceTo(n.v) }))
    .sort((a, b) => a.d - b.d);
  for (const { n, d } of sorted) {
    tmpV.copy(n.v).project(camera);
    const visible = tmpV.z < 1 && Math.abs(tmpV.x) < 1.05 && Math.abs(tmpV.y) < 1.05;
    const near = camDist < 1500 ? d < camDist * 1.5 + 400 : d < 1400;
    if (!visible || !near) {
      n.el.classList.add("hide");
      continue;
    }
    const x = (tmpV.x * 0.5 + 0.5) * innerWidth;
    const y = (-tmpV.y * 0.5 + 0.5) * innerHeight;
    const w = n.el.offsetWidth || 60;
    const hgt = 18;
    const rect = [x - w / 2 - 3, y - hgt - 3, x + w / 2 + 3, y - 3];
    const hit = placed.some((r) => rect[0] < r[2] && r[0] < rect[2] && rect[1] < r[3] && r[1] < rect[3]);
    if (hit) {
      n.el.classList.add("hide");
      continue;
    }
    placed.push(rect);
    n.el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
    n.el.classList.remove("hide");
  }
}

/* ---------------------------------------------------------- 拾取 */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;

renderer.domElement.addEventListener("pointerdown", (e) => { downPos = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!downPos || state.walking) return;
  if (Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]) > 5) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(state.world.pick, false);
  if (hits.length) select(hits[0].object.userData.id, false);
});

/* ---------------------------------------------------------- 顶部按钮 */
const btnHome = $("#btn-home");
const btnTop = $("#btn-top");
const btnTime = $("#btn-time");
const btnWalk = $("#btn-walk");
const btnShot = $("#btn-shot");
const btnAbout = $("#btn-about");

btnHome.onclick = () => {
  const c = state.world.center;
  camera.position.set(c.x + state.world.span * 0.30, c.y + state.world.span * 0.40, c.z + state.world.span * 0.78);
  controls.target.copy(c);
  controls.update();
  shiftForPanel();
  infoEl.classList.add("hidden");
};
btnTop.onclick = () => {
  const c = state.world.center.clone();
  camera.position.set(c.x + 1, c.y + state.world.span * 0.98, c.z + 1);
  controls.update();
  shiftForPanel();
};
const presetKeys = ["day", "dawn", "dusk", "night"];
btnTime.onclick = () => {
  const i = (presetKeys.indexOf(state.preset) + 1) % presetKeys.length;
  state.preset = presetKeys[i];
  const p = applyPreset(state.world, scene, renderer, state.preset);
  btnTime.textContent = p.label;
  drawMinimapBase(state.data);
};
/* 图层 */
const layersBtn = $("#btn-layer");
const layersEl = $("#layers");
layersBtn.onclick = (e) => { e.stopPropagation(); layersEl.classList.toggle("hidden"); };
document.addEventListener("click", (e) => {
  if (!layersEl.contains(e.target) && e.target !== layersBtn) layersEl.classList.add("hidden");
});
layersEl.querySelectorAll("input").forEach((cb) => {
  cb.onchange = () => {
    const w = state.world;
    const k = cb.dataset.layer;
    if (k === "buildings") w.buildings.visible = cb.checked;
    if (k === "roads") w.roadGroup.visible = cb.checked;
    if (k === "trees") w.trees.visible = cb.checked;
    if (k === "water") w.waterGroup.visible = cb.checked;
    if (k === "pitch") w.pitchGroup.visible = cb.checked;
    if (k === "labels") state.showLabels = cb.checked;
    if (k === "sat" && w.matSat) {
      w.terrainMesh.material = cb.checked ? w.matSat : w.matColor;
      if (w.pitchGroup) w.pitchGroup.visible = !cb.checked;
      if (w.green) w.green.visible = !cb.checked;
    }
  };
});

/* 导览：沿经典路线自动巡游 */
const TOUR = ["重庆大学主教学楼", "理工馆", "民主湖", "第五教学楼", "A区体育馆", "美视电影学院剧场"];
let tourTimer = null, tourIdx = 0;

$("#btn-tour").onclick = () => (tourTimer ? stopTour() : startTour());

function startTour() {
  if (state.walking) stopWalk();
  tourIdx = 0;
  $("#btn-tour").classList.add("on");
  const step = () => {
    const name = TOUR[tourIdx % TOUR.length];
    const b = state.data.buildings.find((x) => x.name === name) ||
              state.data.buildings.find((x) => x.name && x.name.includes(name));
    if (b) {
      select(b.id, true);
      const info = TOUR.length;
      $("#btn-tour").textContent = `导览 ${(tourIdx % info) + 1}/${info}`;
    }
    tourIdx++;
  };
  step();
  tourTimer = setInterval(step, 5200);
}

function stopTour() {
  if (tourTimer) clearInterval(tourTimer);
  tourTimer = null;
  $("#btn-tour").classList.remove("on");
  $("#btn-tour").textContent = "导览";
}

$("#compass").onclick = () => {
  const d = camera.position.distanceTo(controls.target);
  const c = controls.target;
  camera.position.set(c.x, c.y + d * 0.9, c.z + d * 0.55);
  controls.update();
};
btnShot.onclick = () => {
  renderer.render(scene, camera);
  const a = document.createElement("a");
  a.download = `cqu-a-3d-${Date.now()}.png`;
  a.href = renderer.domElement.toDataURL("image/png");
  a.click();
};
btnAbout.onclick = () => $("#about").classList.remove("hidden");
$("#about-close").onclick = () => $("#about").classList.add("hidden");

$("#panel-fold").onclick = () => {
  const p = $("#panel");
  p.classList.toggle("folded");
  document.body.classList.toggle("panel-folded", p.classList.contains("folded"));
  $("#panel-fold").textContent = p.classList.contains("folded") ? "+" : "−";
};

/* ---------------------------------------------------------- 漫游 */
const walkEl = $("#walkhud");
const keys = new Set();

btnWalk.onclick = () => (state.walking ? stopWalk() : startWalk());

function startWalk() {
  if (state.walking) return;
  state.walking = true;
  document.body.classList.add("walking");
  btnWalk.classList.add("on");
  walkEl.classList.remove("hidden");
  // 从当前视点落回地面
  const p = camera.position.clone();
  p.y = state.world.H(p.x, p.z) + 1.75;
  if (!canStand(p.x, p.z)) {
    const c = controls.target;
    p.set(c.x, state.world.H(c.x, c.z) + 1.75, c.z);
  }
  camera.position.copy(p);
  const dir = new THREE.Vector3().subVectors(controls.target, p).setY(0).normalize();
  state.yaw = Math.atan2(-dir.x, -dir.z);
  state.pitch = 0;
  renderer.domElement.requestPointerLock?.();
}

function stopWalk() {
  state.walking = false;
  document.body.classList.remove("walking");
  btnWalk.classList.remove("on");
  walkEl.classList.add("hidden");
  if (document.pointerLockElement) document.exitPointerLock();
  const gy = state.world.H(camera.position.x, camera.position.z);
  controls.target.set(camera.position.x, gy, camera.position.z);
  camera.position.y = gy + 90;
  controls.update();
}

document.addEventListener("pointerlockchange", () => {
  if (!document.pointerLockElement && state.walking) stopWalk();
});
document.addEventListener("mousemove", (e) => {
  if (!state.walking || !document.pointerLockElement) return;
  state.yaw -= e.movementX * 0.0022;
  state.pitch = THREE.MathUtils.clamp(state.pitch - e.movementY * 0.0022, -1.1, 1.1);
});
addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "Escape" && state.walking) stopWalk();
});
addEventListener("keyup", (e) => keys.delete(e.code));

function canStand(x, z) {
  const d = state.data;
  if (!pointInPoly(x, z, d.boundary)) return false;
  for (const b of d.buildings) {
    const bb = b.bbox;
    if (x < bb.minX - 1 || x > bb.maxX + 1 || z < bb.minZ - 1 || z > bb.maxZ + 1) continue;
    if (pointInPoly(x, z, b.poly)) return false;
  }
  for (const w of d.water) if (pointInPoly(x, z, w.poly)) return false;
  return true;
}

const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
function updateWalk(dt) {
  const speed = (keys.has("ShiftLeft") || keys.has("ShiftRight")) ? 13 : 5.2;
  fwd.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  right.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  const move = new THREE.Vector3();
  if (keys.has("KeyW") || keys.has("ArrowUp")) move.add(fwd);
  if (keys.has("KeyS") || keys.has("ArrowDown")) move.sub(fwd);
  if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(right);
  if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(right);
  if (move.lengthSq() > 0) move.normalize().multiplyScalar(speed * dt);

  // 轴分离碰撞，遇到建筑/水面可沿墙滑动
  if (move.x && canStand(camera.position.x + move.x, camera.position.z)) camera.position.x += move.x;
  if (move.z && canStand(camera.position.x, camera.position.z + move.z)) camera.position.z += move.z;
  camera.position.y = state.world.H(camera.position.x, camera.position.z) + 1.75;

  const dir = new THREE.Vector3(-Math.sin(state.yaw), Math.tan(state.pitch), -Math.cos(state.yaw)).normalize();
  camera.lookAt(camera.position.clone().add(dir));
  walkEl.querySelector(".wh-pos").textContent =
    `坐标 ${camera.position.x.toFixed(0)}, ${camera.position.z.toFixed(0)} m · 速度 ${speed} m/s`;
}

/* ---------------------------------------------------------- 比例尺 / 罗盘 */
function updateScale() {
  const dist = camera.position.distanceTo(controls.target);
  const mPerPx = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / innerHeight;
  const targets = [20, 50, 100, 200, 500];
  const meters = targets.find((t) => t / mPerPx > 60) || 500;
  const px = meters / mPerPx;
  const bar = $("#scalebar");
  bar.querySelector("i").style.width = px.toFixed(0) + "px";
  bar.querySelector("span").textContent = meters + " m";
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const ang = Math.atan2(dir.x, dir.z);
  $("#needle").style.transform = `rotate(${(-ang * 180) / Math.PI + 180}deg)`;
  $("#needle").style.transformOrigin = "20px 20px";
}

/* ---------------------------------------------------------- 小地图 */
const mini = $("#minimap");
const mctx = mini.getContext("2d");
let miniBase = null;
const MINI = 180;
let miniB = null;

function miniProject(data) {
  const b = data.meta.bounds;
  const s = (MINI - 16) / Math.max(b.maxX - b.minX, b.maxZ - b.minZ);
  const ox = (MINI - (b.maxX - b.minX) * s) / 2;
  const oz = (MINI - (b.maxZ - b.minZ) * s) / 2;
  return {
    s,
    f: (x, z) => [ox + (x - b.minX) * s, oz + (z - b.minZ) * s],
  };
}

function drawMinimapBase(data) {
  miniB = miniProject(data);
  const c = document.createElement("canvas");
  c.width = c.height = MINI;
  const g = c.getContext("2d");
  const night = state.preset === "night";
  g.fillStyle = night ? "rgba(10,18,32,.82)" : "rgba(255,255,255,.82)";
  g.fillRect(0, 0, MINI, MINI);
  const f = miniB.f;
  g.beginPath();
  data.boundary.forEach(([x, z], i) => (i ? g.lineTo(...f(x, z)) : g.moveTo(...f(x, z))));
  g.closePath();
  g.fillStyle = night ? "rgba(46,82,56,.85)" : "rgba(120,158,116,.35)";
  g.fill();
  data.water.forEach((w) => {
    g.beginPath();
    w.poly.forEach(([x, z], i) => (i ? g.lineTo(...f(x, z)) : g.moveTo(...f(x, z))));
    g.closePath();
    g.fillStyle = night ? "#1f4a68" : "#8ab6cf";
    g.fill();
  });
  data.buildings.forEach((b) => {
    g.beginPath();
    b.poly.forEach(([x, z], i) => (i ? g.lineTo(...f(x, z)) : g.moveTo(...f(x, z))));
    g.closePath();
    g.fillStyle = b.kind === "historic" ? "#b8735c" : night ? "#7d8ea6" : "#5d6b7d";
    g.globalAlpha = 0.85;
    g.fill();
    g.globalAlpha = 1;
  });
  miniBase = c;
}

function drawMinimap() {
  if (!miniBase || !state.world) return;
  mctx.clearRect(0, 0, MINI, MINI);
  mctx.drawImage(miniBase, 0, 0);
  const f = miniB.f;
  const [tx, tz] = f(controls.target.x, controls.target.z);
  mctx.beginPath();
  mctx.arc(tx, tz, 9, 0, Math.PI * 2);
  mctx.strokeStyle = "rgba(47,110,165,.85)";
  mctx.lineWidth = 1;
  mctx.stroke();
  const [cx, cz] = f(camera.position.x, camera.position.z);
  mctx.beginPath();
  mctx.arc(cx, cz, 3.2, 0, Math.PI * 2);
  mctx.fillStyle = "#2f6ea5";
  mctx.fill();
  mctx.beginPath();
  mctx.moveTo(cx, cz);
  mctx.lineTo(tx, tz);
  mctx.strokeStyle = "rgba(47,110,165,.5)";
  mctx.stroke();
}

/* ---------------------------------------------------------- 统计 */
function updateStats() {
  const c = state.data.meta.counts;
  $("#stat").textContent =
    `${c.buildings} 栋建筑 · ${c.roads} 条道路 · ${c.trees} 株树木 · 校园 ${(state.data.meta.area / 10000).toFixed(2)} 公顷 · 数据 OpenStreetMap`;
}

/* ---------------------------------------------------------- 主循环 */
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.walking) updateWalk(dt);
  else controls.update();
  if (state.world.sky) state.world.sky.position.copy(camera.position);
  updateLabels();
  updateScale();
  drawMinimap();
  renderer.render(scene, camera);
}

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
