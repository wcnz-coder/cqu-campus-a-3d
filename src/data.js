// 数据加载与几何工具
export const KIND_INFO = {
  historic: { label: "历史建筑", color: "#b8735c", listColor: "#c98b72" },
  library: { label: "图书馆", color: "#78b6ab", listColor: "#8fc6bd" },
  teach: { label: "教学", color: "#cbb98c", listColor: "#d8c9a8" },
  lab: { label: "科研实验", color: "#9fb6cc", listColor: "#b9cbdd" },
  admin: { label: "院系办公", color: "#c3c6d2", listColor: "#d5d8e2" },
  dorm: { label: "宿舍公寓", color: "#b3a4c9", listColor: "#c8bcd9" },
  food: { label: "食堂生活", color: "#d9a583", listColor: "#e6bfa4" },
  sport: { label: "体育场馆", color: "#8fc08a", listColor: "#a8cfa3" },
  misc: { label: "其他建筑", color: "#b9bdc4", listColor: "#cdd1d7" },
};
export const KIND_ORDER = ["historic", "library", "teach", "lab", "admin", "dorm", "food", "sport", "misc"];

export async function loadCampus(url = "./public/data/campus.json") {
  // 单文件版（file:// 直接双击打开）没有 fetch 能力，数据由 window.__CAMPUS__ 内联注入
  let data;
  if (typeof window !== "undefined" && window.__CAMPUS__) {
    data = window.__CAMPUS__;
  } else {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error("校园数据加载失败: " + res.status);
    data = await res.json();
  }
  // 预计算：每个建筑的面积、包围盒、名称索引
  data.buildings.forEach((b) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    b.poly.forEach(([x, z]) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    });
    b.bbox = { minX, maxX, minZ, maxZ };
    b.landmark = (data.landmarks || []).find((l) => l.name === b.name) || null;
  });
  data.byId = new Map(data.buildings.map((b) => [b.id, b]));
  return data;
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1];
    const xj = poly[j][0], zj = poly[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export function polyCenter(poly) {
  let x = 0, z = 0;
  poly.forEach((p) => { x += p[0]; z += p[1]; });
  return [x / poly.length, z / poly.length];
}

export function fmtArea(m2) {
  if (m2 >= 10000) return (m2 / 10000).toFixed(1) + " 公顷";
  return Math.round(m2) + " m²";
}
