#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""OSM 原始数据 -> 网页场景数据 campus.json

输入 : raw_osm_a.json  (Overpass API out geom tags 的产物)
输出 : public/data/campus.json  (米制局部坐标，x=东, z=南)

只用标准库，坐标系为以校园中心为原点的等距圆柱投影（误差 < 0.1%）。
"""
import json
import math
import os
import sys
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "raw_osm_a.json")
OUT = os.path.join(ROOT, "public", "data", "campus.json")

CAMPUS_NAME = "重庆大学A区"

# 层高（米）与高度兜底
FLOOR_H = 3.8

# 明确知道的建筑高度（米），优先级最高
HEIGHT_OVERRIDE = {
    "重庆大学主教学楼": 34.0,     # 实为长条板楼+中部塔楼，78 m 会把校园压成一个尖
    "理工馆": 32.0,
    "重庆大学A区体育馆": 24.0,
    "综合实验大楼": 26.0,
    "理科教学楼": 25.0,
    "生命工程学院": 26.0,
    "第八教学楼": 24.0,
    "第五教学楼": 19.0,
    "第六教学楼": 21.0,
    "民主湖报告厅": 16.0,
    "博雅书院": 20.0,
    "经济与工商管理学院": 24.0,
    "理学院": 28.0,
    "重庆大学工学院楼": 17.0,
    "新华楼": 16.0,
    "人文社会科学研究院": 24.0,
    "重庆大学艺术学院": 20.0,
    "美视电影学院剧场": 22.0,
    "煤矿灾害动力学与控制全国重点实验室": 24.0,
    "重庆大学非均质材料力学重点实验室": 20.0,
    "资源与安全学院": 22.0,
    "重庆大学制造工程研究所": 20.0,
    "A区工艺楼": 18.0,
    "材料楼": 20.0,
    "学生一食堂": 14.0,
    "第五食堂": 14.0,
}

# 类别 -> 前端配色键
KIND_RULES = [
    ("dorm", ("宿舍", "公寓", "学生舍", "青教楼", "明礼苑", "明德苑", "明善")),
    ("food", ("食堂", "餐厅", "咖啡", "超市")),
    ("sport", ("体育馆", "体育场", "操场", "游泳", "风雨", "剧场", "礼堂")),
    ("library", ("图书馆", "理工馆", "档案馆", "校史")),
    ("lab", ("实验", "研究", "重点实验室", "中心", "测试")),
    ("historic", ("工学院楼", "新华楼", "文字斋", "寅初", "旧址", "故居")),
    ("admin", ("办公", "管理处", "工作处", "委员会", "学院", "学部", "研究院", "书院")),
    ("teach", ("教学楼", "教室", "学堂", "教学楼", "楼")),
]

LANDMARKS = {
    "重庆大学主教学楼": ("A区主教学楼", "20 层、约 78 米高的校园制高点，A 区的视觉中心。顶层钟楼与竖线条立面是老校区最易辨认的轮廓。"),
    "理工馆": ("理工馆（A 区图书馆）", "A 区图书馆主体，藏书与自习空间集中于此，临民主湖一侧有长条阅览廊。"),
    "重庆大学工学院楼": ("工学院楼", "抗战时期内迁办学时期留存的老楼之一，红砖坡顶，现为校史与院系办公空间。"),
    "新华楼": ("新华楼", "A 区北侧的教学老楼，与工学院楼一同构成北区的历史建筑群。"),
    "民主湖": ("民主湖", "A 区最著名的水面，湖名纪念抗战时期的民主运动，环湖步道是学生晨读与散步的经典路线。"),
    "重庆大学A区体育馆": ("A 区体育馆", "东侧的大型室内场馆，篮球、羽毛球与大型集会场地。"),
    "第五教学楼": ("第五教学楼", "A 区中部的大体量公共教学楼，阶梯教室集中。"),
    "第八教学楼": ("第八教学楼", "紧邻五教，考试与公共课的主要考场楼之一。"),
    "第六教学楼": ("第六教学楼", "西侧长条形教学楼，南北向展开。"),
    "理科教学楼": ("理科教学楼", "西区理科课程主楼，与综合实验大楼相邻。"),
    "学生一食堂": ("学生一食堂", "A 区规模最大的食堂，饭点人流密集。"),
    "美视电影学院剧场": ("美视电影学院剧场", "电影学院的教学剧场与放映厅。"),
}

ROAD_WIDTH = {
    "primary": 16.0, "secondary": 12.0, "tertiary": 9.0,
    "residential": 7.0, "unclassified": 6.5, "service": 4.5,
    "pedestrian": 9.0, "footway": 2.4, "steps": 2.4,
    "cycleway": 2.6, "path": 2.2, "living_street": 6.0,
}
ROAD_KIND = {
    "primary": "主干道", "secondary": "次干道", "tertiary": "支路",
    "residential": "校内路", "unclassified": "校内路", "service": "支路",
    "pedestrian": "步行道", "footway": "步道", "steps": "台阶",
    "cycleway": "步道", "path": "步道", "living_street": "校内路",
}


# ---------------------------------------------------------------- 几何工具
def ring_area(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, z1 = pts[i]
        x2, z2 = pts[(i + 1) % len(pts)]
        a += x1 * z2 - x2 * z1
    return a / 2.0


def point_in_ring(x, z, ring):
    inside = False
    n = len(ring)
    for i in range(n):
        x1, z1 = ring[i]
        x2, z2 = ring[(i + 1) % n]
        if (z1 > z) != (z2 > z):
            xin = x1 + (z - z1) * (x2 - x1) / (z2 - z1)
            if x < xin:
                inside = not inside
    return inside


def simplify(pts, eps=0.55):
    """Douglas-Peucker，保持闭合环。"""
    if len(pts) <= 4:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, az = pts[a]
        bx, bz = pts[b]
        dx, dz = bx - ax, bz - az
        norm = math.hypot(dx, dz) or 1e-9
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, pz = pts[i]
            d = abs(dz * (px - ax) - dx * (pz - az)) / norm
            if d > best:
                best, bi = d, i
        if best > eps:
            keep[bi] = True
            stack += [(a, bi), (bi, b)]
    out = [p for p, k in zip(pts, keep) if k]
    return out if len(out) >= 4 else pts


def classify(name, tags):
    h = (name or "") + " " + (tags.get("building") or "")
    if tags.get("building") == "dormitory":
        return "dorm"
    for kind, keys in KIND_RULES:
        for k in keys:
            if k and k in h:
                return kind
    if tags.get("building") in ("apartments", "residential"):
        return "dorm"
    return "misc"


def level_guess(area):
    if area > 6000:
        return 6
    if area > 2600:
        return 5
    if area > 900:
        return 4
    return 3


# ---------------------------------------------------------------- 主流程
def main():
    data = json.load(open(SRC, encoding="utf-8"))
    els = data["elements"]

    # 1. 校园边界
    boundary_src = None
    for e in els:
        t = e.get("tags", {})
        if t.get("name") == CAMPUS_NAME and t.get("amenity") == "university":
            boundary_src = e
            break
    if boundary_src is None:
        sys.exit("未找到校园边界 way: " + CAMPUS_NAME)

    raw = boundary_src["geometry"]
    lat0 = sum(p["lat"] for p in raw) / len(raw)
    lon0 = sum(p["lon"] for p in raw) / len(raw)
    kx = 111320.0 * math.cos(math.radians(lat0))
    kz = 110574.0

    def proj(lat, lon):
        return ((lon - lon0) * kx, (lat0 - lat) * kz)

    boundary = [proj(p["lat"], p["lon"]) for p in raw]
    if ring_area(boundary) < 0:
        boundary.reverse()
    boundary = simplify(boundary, 0.4)

    def inside(x, z, margin=0.0):
        if margin <= 0:
            return point_in_ring(x, z, boundary)
        # 粗略膨胀：同时允许边界外 margin 米
        if point_in_ring(x, z, boundary):
            return True
        return any(math.hypot(x - bx, z - bz) < margin for bx, bz in boundary[::2])

    buildings, water, pitches, greens, roads, gates = [], [], [], [], [], []

    for e in els:
        if e["type"] != "way":
            continue
        t = e.get("tags", {})
        g = e.get("geometry") or []
        if len(g) < 2:
            continue
        pts = [proj(p["lat"], p["lon"]) for p in g]

        if "building" in t:
            ring = simplify(pts, 0.45)
            if len(ring) < 4:
                continue
            area = abs(ring_area(ring))
            cx = sum(p[0] for p in ring) / len(ring)
            cz = sum(p[1] for p in ring) / len(ring)
            if not point_in_ring(cx, cz, boundary) or area < 24:
                continue
            name = t.get("name") or ""
            lv = t.get("building:levels")
            try:
                lv = int(float(lv)) if lv else None
            except ValueError:
                lv = None
            idx = len(buildings)
            h = HEIGHT_OVERRIDE.get(name)
            if h is None:
                h = (lv or level_guess(area)) * FLOOR_H + 1.6
                if t.get("building") in ("dormitory", "apartments", "residential"):
                    h = (lv or 6) * 3.2 + 1.4
            buildings.append({
                "id": e["id"],
                "i": idx,
                "name": name,
                "kind": classify(name, t),
                "h": round(h, 1),
                "lv": lv or 0,
                "area": round(area),
                "c": [round(cx, 1), round(cz, 1)],
                "poly": [[round(x, 1), round(z, 1)] for x, z in ring],
                "tag": t.get("building") or "yes",
            })
            continue

        if t.get("natural") == "water":
            ring = simplify(pts, 0.5)
            if len(ring) < 4:
                continue
            cx = sum(p[0] for p in ring) / len(ring)
            cz = sum(p[1] for p in ring) / len(ring)
            if not point_in_ring(cx, cz, boundary):
                continue
            water.append({"name": t.get("name") or "", "poly": [[round(x, 1), round(z, 1)] for x, z in ring]})
            continue

        if t.get("leisure") == "pitch" or t.get("leisure") == "stadium":
            ring = simplify(pts, 0.7)
            if len(ring) < 3:
                continue
            cx = sum(p[0] for p in ring) / len(ring)
            cz = sum(p[1] for p in ring) / len(ring)
            if not point_in_ring(cx, cz, boundary):
                continue
            pitches.append({
                "name": t.get("name") or "",
                "sport": t.get("sport") or ("soccer" if t.get("leisure") == "stadium" else "generic"),
                "poly": [[round(x, 1), round(z, 1)] for x, z in ring],
            })
            continue

        if t.get("landuse") in ("grass", "forest", "park", "recreation_ground", "village_green") or t.get("leisure") in ("park", "garden"):
            ring = simplify(pts, 1.2)
            if len(ring) < 3:
                continue
            cx = sum(p[0] for p in ring) / len(ring)
            cz = sum(p[1] for p in ring) / len(ring)
            if not point_in_ring(cx, cz, boundary):
                continue
            greens.append({"poly": [[round(x, 1), round(z, 1)] for x, z in ring]})
            continue

        if "highway" in t:
            hw = t["highway"]
            if hw in ("motorway", "trunk"):
                continue
            width = ROAD_WIDTH.get(hw, 4.0)
            # 只保留落在校园内（或边界附近）的线段
            runs, cur = [], []
            for x, z in densify(pts, 6.0):
                if inside(x, z, 26.0):
                    cur.append((x, z))
                else:
                    if len(cur) >= 2:
                        runs.append(cur)
                    cur = []
            if len(cur) >= 2:
                runs.append(cur)
            for run in runs:
                if polyline_len(run) < 12:
                    continue
                roads.append({
                    "name": t.get("name") or "",
                    "kind": ROAD_KIND.get(hw, "步道"),
                    "hw": hw,
                    "w": width,
                    "pts": [[round(x, 1), round(z, 1)] for x, z in simplify(run, 0.8)],
                })
            continue

        if t.get("barrier") == "gate":
            cx = sum(p[0] for p in pts) / len(pts)
            cz = sum(p[1] for p in pts) / len(pts)
            if inside(cx, cz, 30):
                gates.append([round(cx, 1), round(cz, 1)])

    # 2. 树木：沿步道/支路两侧，落在草地/空地且不压建筑
    trees = []
    import random
    random.seed(20261027)
    def blocked(x, z):
        for b in buildings:
            if math.hypot(x - b["c"][0], z - b["c"][1]) < 12:
                return True
            if point_in_ring(x, z, b["poly"]):
                return True
        for w in water:
            if point_in_ring(x, z, w["poly"]):
                return True
        for p in pitches:
            if point_in_ring(x, z, p["poly"]):
                return True
        return False

    for r in roads:
        if r["hw"] not in ("footway", "steps", "service", "unclassified", "residential", "pedestrian"):
            continue
        pts = r["pts"]
        for i in range(len(pts) - 1):
            x1, z1 = pts[i]
            x2, z2 = pts[i + 1]
            seg = math.hypot(x2 - x1, z2 - z1)
            steps = int(seg // 17)
            for s in range(steps):
                f = (s + 0.5) / max(steps, 1)
                x = x1 + (x2 - x1) * f
                z = z1 + (z2 - z1) * f
                nx, nz = -(z2 - z1) / (seg or 1), (x2 - x1) / (seg or 1)
                for side in (1, -1):
                    off = 4.2 + random.random() * 3.0
                    tx, tz = x + nx * off * side, z + nz * off * side
                    if not point_in_ring(tx, tz, boundary) or blocked(tx, tz):
                        continue
                    trees.append([round(tx, 1), round(tz, 1), round(0.8 + random.random() * 0.55, 2)])
    for gr in greens:
        xs = [p[0] for p in gr["poly"]]
        zs = [p[1] for p in gr["poly"]]
        n = min(40, int(abs((max(xs) - min(xs)) * (max(zs) - min(zs))) / 260))
        for _ in range(n):
            tx = random.uniform(min(xs), max(xs))
            tz = random.uniform(min(zs), max(zs))
            if point_in_ring(tx, tz, gr["poly"]) and not blocked(tx, tz):
                trees.append([round(tx, 1), round(tz, 1), round(0.85 + random.random() * 0.6, 2)])
    # 去重
    seen, uniq = set(), []
    for t in trees:
        key = (round(t[0] / 6), round(t[1] / 6))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(t)
    trees = uniq[:1400]

    xs = [p[0] for p in boundary]
    zs = [p[1] for p in boundary]
    scene = {
        "meta": {
            "name": "重庆大学 A 区",
            "fullName": "重庆大学沙坪坝校区（A 区）",
            "center": [round(lat0, 6), round(lon0, 6)],
            "bounds": {"minX": round(min(xs), 1), "maxX": round(max(xs), 1),
                        "minZ": round(min(zs), 1), "maxZ": round(max(zs), 1)},
            "area": round(abs(ring_area(boundary))),
            "source": "OpenStreetMap（ODbL 1.0）· Overpass API 2026-10-27",
            "generated": "2026-10-27",
            "counts": {"buildings": len(buildings), "roads": len(roads), "water": len(water),
                        "pitches": len(pitches), "trees": len(trees)},
        },
        "boundary": [[round(x, 1), round(z, 1)] for x, z in boundary],
        "buildings": buildings,
        "water": water,
        "roads": roads,
        "pitches": pitches,
        "greens": greens,
        "gates": gates,
        "trees": trees,
        "landmarks": [{"name": k, "title": v[0], "desc": v[1]} for k, v in LANDMARKS.items()],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(scene, f, ensure_ascii=False, separators=(",", ":"))
    print("buildings=%d roads=%d water=%d pitches=%d greens=%d trees=%d gates=%d  area=%.0f m2  -> %s (%.0f KB)"
          % (len(buildings), len(roads), len(water), len(pitches), len(greens), len(trees), len(gates),
             scene["meta"]["area"], OUT, os.path.getsize(OUT) / 1024))
    print("bounds", scene["meta"]["bounds"])


def densify(pts, step):
    out = []
    for i in range(len(pts) - 1):
        x1, z1 = pts[i]
        x2, z2 = pts[i + 1]
        d = math.hypot(x2 - x1, z2 - z1)
        n = max(1, int(d / step))
        for s in range(n):
            f = s / n
            out.append((x1 + (x2 - x1) * f, z1 + (z2 - z1) * f))
    out.append(pts[-1])
    return out


def polyline_len(pts):
    return sum(math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) for i in range(len(pts) - 1))


if __name__ == "__main__":
    main()
