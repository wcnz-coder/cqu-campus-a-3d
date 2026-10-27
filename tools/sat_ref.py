#!/usr/bin/env python3
"""下载高德卫星瓦片并拼成一张 A 区正射参考图（仅用于取颜色/核对形状，不随站点分发）。

用法: python tools/sat_ref.py            # 输出 cqu-a-3d/data/sat_ref.png + sat_meta.json
"""
import json
import math
import pathlib
import subprocess
import time

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT_PNG = ROOT / "data" / "sat_ref.png"
OUT_META = ROOT / "data" / "sat_meta.json"
CACHE = ROOT / "data" / "sat_tiles"

LAT0, LON0 = 29.566466, 106.466013          # 与 campus.json 同一原点
KX = 111320 * math.cos(math.radians(LAT0))
KZ = 110574
Z = 17

# A 区范围（米，相对原点），稍放宽
XMIN, XMAX = -1120, 1020
ZMIN, ZMAX = -1280, 920


def merc(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def to_latlon(x, z):
    return LAT0 - z / KZ, LON0 + x / KX


def fetch(tx, ty, z):
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / f"{z}_{tx}_{ty}.jpg"
    if p.exists() and p.stat().st_size > 1000:
        return p
    url = f"https://webst01.is.autonavi.com/appmaptile?style=6&x={tx}&y={ty}&z={z}"
    subprocess.run(["curl", "-s", "--max-time", "25", "-H", "Referer: https://www.amap.com/",
                    "-o", str(p), url], check=False)
    time.sleep(0.05)
    return p


def main():
    # 四角 → 瓦片范围
    lat_n, lon_w = to_latlon(XMIN, ZMIN)      # z 小 = 北
    lat_s, lon_e = to_latlon(XMAX, ZMAX)
    x0, y0 = merc(lat_n, lon_w, Z)
    x1, y1 = merc(lat_s, lon_e, Z)
    tx0, tx1 = int(x0), int(x1)
    ty0, ty1 = int(y0), int(y1)
    tw, th = tx1 - tx0 + 1, ty1 - ty0 + 1
    print(f"tiles {tw}x{th} = {tw*th} 张 @z{Z}")

    img = Image.new("RGB", (tw * 256, th * 256), (20, 26, 20))
    got = 0
    for j, ty in enumerate(range(ty0, ty1 + 1)):
        for i, tx in enumerate(range(tx0, tx1 + 1)):
            p = fetch(tx, ty, Z)
            try:
                t = Image.open(p).convert("RGB")
            except Exception:
                continue
            img.paste(t, (i * 256, j * 256))
            got += 1
        print(f"  row {j+1}/{th}", end="\r")
    print(f"\n拼接完成 {got}/{tw*th}")

    # 记录局部米制 → 像素的映射：pixel = (tx)*256 + frac
    meta = {
        "z": Z, "tx0": tx0, "ty0": ty0, "tw": tw, "th": th,
        "lat0": LAT0, "lon0": LON0, "kx": KX, "kz": KZ,
        "merc_x0": x0, "merc_y0": y0,
        "bounds_m": [XMIN, XMAX, ZMIN, ZMAX],
    }
    OUT_PNG.parent.mkdir(exist_ok=True)
    img.save(OUT_PNG)
    OUT_META.write_text(json.dumps(meta, indent=1), encoding="utf-8")
    print("->", OUT_PNG, img.size)


if __name__ == "__main__":
    main()
