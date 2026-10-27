#!/usr/bin/env python3
"""从高德卫星参考图里取每栋楼的屋顶颜色，写回 campus.json 的 b.roof / b.wall。

思路：把建筑多边形栅格化到卫星图像素坐标，取内部像素（腐蚀 1.5 m 去掉墙边），
按亮度排序丢掉最暗的 35%（树影/投影）后取中位色，再做轻微饱和度提升。
"""
import json
import math
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
META = json.loads((ROOT / "data/sat_meta.json").read_text())
DATA = ROOT / "public/data/campus.json"

Z = META["z"]
TX0, TY0 = META["tx0"], META["ty0"]
LAT0, LON0 = META["lat0"], META["lon0"]
KX, KZ = META["kx"], META["kz"]

img = Image.open(ROOT / "data/sat_ref.png").convert("RGB")
PX = img.load()
W, H = img.size


def px_of(x, z):
    lat = LAT0 - z / KZ
    lon = LON0 + x / KX
    n = 2 ** Z
    mx = (lon + 180) / 360 * n
    my = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return (mx - TX0) * 256, (my - TY0) * 256


def inside(pts, x, y):
    c = False
    j = len(pts) - 1
    for i in range(len(pts)):
        xi, yi = pts[i]
        xj, yj = pts[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi:
            c = not c
        j = i
    return c


def sample(poly, erode_px):
    pts = [px_of(x, z) for x, z in poly]
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    x0, x1 = int(max(0, min(xs))), int(min(W - 1, max(xs)))
    y0, y1 = int(max(0, min(ys))), int(min(H - 1, max(ys)))
    if x1 <= x0 or y1 <= y0:
        return None
    cols = []
    step = 1 if (x1 - x0) < 60 else 2
    for y in range(y0, y1 + 1, step):
        for x in range(x0, x1 + 1, step):
            if inside(pts, x + 0.5, y + 0.5):
                cols.append(PX[x, y])
    if len(cols) < 12:
        return None
    # 先剔掉「像树」的像素：绿色明显压过红蓝
    veg = lambda c: c[1] > c[0] * 1.12 and c[1] > c[2] * 1.12
    keep = [c for c in cols if not veg(c)]
    if len(keep) >= max(12, len(cols) * 0.25):
        cols = keep
    cols.sort(key=lambda c: c[0] * 0.3 + c[1] * 0.6 + c[2] * 0.1)
    lo = int(len(cols) * 0.35)
    hi = int(len(cols) * 0.92)
    sel = cols[lo:max(hi, lo + 4)]
    r = sum(c[0] for c in sel) / len(sel)
    g = sum(c[1] for c in sel) / len(sel)
    b = sum(c[2] for c in sel) / len(sel)
    return (r, g, b)


def boost(c, sat=1.35, lift=1.06):
    r, g, b = c
    m = (r + g + b) / 3
    r, g, b = (m + (v - m) * sat for v in (r, g, b))
    r, g, b = (min(255, v * lift) for v in (r, g, b))
    return "#%02x%02x%02x" % (int(r), int(g), int(b))


def main():
    data = json.loads(DATA.read_text(encoding="utf-8"))
    got = 0
    for b in data["buildings"]:
        c = sample(b["poly"], 2)
        if not c:
            continue
        b["roof"] = boost(c)
        # 墙：屋顶色去饱和 + 提亮（立面通常比屋顶浅、更灰）
        wall = boost(c, sat=0.55, lift=1.22)
        b["wall"] = wall
        got += 1
    data["meta"]["colorsFrom"] = "Amap satellite z17"
    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"sampled {got}/{len(data['buildings'])} buildings")
    # 打印几个知名建筑便于核对
    for b in data["buildings"]:
        if b.get("name") and any(k in b["name"] for k in ("主教学", "图书馆", "五教", "八教", "体育馆", "食堂")):
            print(f"  {b['name']}: roof={b.get('roof')} wall={b.get('wall')}")


if __name__ == "__main__":
    main()
