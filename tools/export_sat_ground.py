#!/usr/bin/env python3
"""把卫星参考图裁到校园范围，导出成前端用的地面贴图 sat_ground.jpg，并写 meta.ground。

地面贴图让操场/道路/绿地/湖水直接就是真实影像，比手搓草地和色块准得多。
"""
import json
import math
import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
META = json.loads((ROOT / "data/sat_meta.json").read_text())
DATA = ROOT / "public/data/campus.json"
OUT = ROOT / "public/data/sat_ground.jpg"

Z = META["z"]
TX0, TY0 = META["tx0"], META["ty0"]
LAT0, LON0 = META["lat0"], META["lon0"]
KX, KZ = META["kx"], META["kz"]

# 比校园稍外扩，避免边缘出现空白
PAD = 120
MINX, MAXX = -1120, 1020
MINZ, MAXZ = -1280, 920


def px_of(x, z):
    lat = LAT0 - z / KZ
    lon = LON0 + x / KX
    n = 2 ** Z
    mx = (lon + 180) / 360 * n
    my = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return (mx - TX0) * 256, (my - TY0) * 256


def main():
    img = Image.open(ROOT / "data/sat_ref.png").convert("RGB")
    x0, y0 = px_of(MINX, MINZ)     # 西北角
    x1, y1 = px_of(MAXX, MAXZ)     # 东南角
    box = (int(x0), int(y0), int(x1), int(y1))
    crop = img.crop(box)
    # 控制体积：最长边 2048
    if max(crop.size) > 2048:
        r = 2048 / max(crop.size)
        crop = crop.resize((int(crop.width * r), int(crop.height * r)), Image.LANCZOS)
    crop.save(OUT, quality=86, optimize=True)

    data = json.loads(DATA.read_text(encoding="utf-8"))
    data["meta"]["ground"] = {
        "minX": MINX, "maxX": MAXX, "minZ": MINZ, "maxZ": MAXZ,
        "url": "public/data/sat_ground.jpg", "px": list(crop.size),
    }
    DATA.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"-> {OUT} {crop.size} {OUT.stat().st_size//1024} KB  bounds=({MINX},{MINZ})..({MAXX},{MAXZ})")


if __name__ == "__main__":
    main()
