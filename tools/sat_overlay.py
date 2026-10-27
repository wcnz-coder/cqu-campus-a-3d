#!/usr/bin/env python3
"""把 campus.json 的轮廓叠到卫星参考图上，检查坐标是否对齐（只用于自检）。"""
import json
import math
import pathlib

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
meta = json.loads((ROOT / "data/sat_meta.json").read_text())
data = json.loads((ROOT / "public/data/campus.json").read_text(encoding="utf-8"))

Z = meta["z"]
TX0, TY0, TW, TH = meta["tx0"], meta["ty0"], meta["tw"], meta["th"]
LAT0, LON0 = meta["lat0"], meta["lon0"]
KX, KZ = meta["kx"], meta["kz"]


def px_of(x, z):
    lat = LAT0 - z / KZ
    lon = LON0 + x / KX
    n = 2 ** Z
    mx = (lon + 180) / 360 * n
    my = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return (mx - TX0) * 256, (my - TY0) * 256


img = Image.open(ROOT / "data/sat_ref.png").convert("RGB")
dr = ImageDraw.Draw(img, "RGBA")

def poly(pts, color, width=2):
    dr.line([px_of(x, z) for x, z in pts] + [px_of(*pts[0])], fill=color, width=width)

poly(data["boundary"], (255, 60, 60, 230), 4)
for b in data["buildings"]:
    poly(b["poly"], (60, 200, 255, 220), 2)
for w in data["water"]:
    poly(w["poly"], (30, 120, 255, 230), 3)

out = ROOT / "data/sat_overlay.png"
img.save(out)
print("->", out, img.size)
