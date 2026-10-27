#!/usr/bin/env python3
"""把 SRTM 高程注入 campus.json，让校园立起来。

数据：SRTM 1 弧秒（约 30 m）N29E106.hgt（原始 big-endian int16，3601×3601）。
输出：campus.json 里新增 terrain 块 {res, minX, minZ, nx, nz, h}，
      h 为 int 米，按 z 行优先排列，x 递增。

用法：python tools/dem2terrain.py [--res 10] [--margin 480]
"""
import argparse
import json
import math
import struct
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
HGT = ROOT / "data" / "N29E106.hgt"
OUT = ROOT / "public" / "data" / "campus.json"

HGT_LAT0, HGT_LON0 = 30.0, 106.0      # N29E106 的西北角


def load_hgt(path):
    buf = path.read_bytes()
    n = int(math.sqrt(len(buf) / 2))
    arr = np.frombuffer(buf, dtype=">i2").reshape(n, n).astype(np.float64)
    arr[arr < -1000] = np.nan          # SRTM void
    return arr, n


def sample(arr, n, lat, lon):
    """双线性采样：HGT 行 0 在北（lat=HGT_LAT0），列 0 在西。"""
    r = (HGT_LAT0 - lat) * (n - 1)
    c = (lon - HGT_LON0) * (n - 1)
    r = np.clip(r, 0, n - 1.001)
    c = np.clip(c, 0, n - 1.001)
    r0 = np.floor(r).astype(int)
    c0 = np.floor(c).astype(int)
    fr = r - r0
    fc = c - c0
    v00 = arr[r0, c0]
    v01 = arr[r0, c0 + 1]
    v10 = arr[r0 + 1, c0]
    v11 = arr[r0 + 1, c0 + 1]
    top = v00 * (1 - fc) + v01 * fc
    bot = v10 * (1 - fc) + v11 * fc
    return top * (1 - fr) + bot * fr


def box_blur(a, passes=2):
    for _ in range(passes):
        p = np.pad(a, 1, mode="edge")
        a = (p[:-2, :-2] + p[:-2, 1:-1] + p[:-2, 2:] +
             p[1:-1, :-2] + p[1:-1, 1:-1] + p[1:-1, 2:] +
             p[2:, :-2] + p[2:, 1:-1] + p[2:, 2:]) / 9.0
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--res", type=float, default=10.0, help="网格间距（米）")
    ap.add_argument("--margin", type=float, default=480.0, help="向校园外扩展（米）")
    args = ap.parse_args()

    data = json.loads(OUT.read_text(encoding="utf-8"))
    meta = data["meta"]
    lat0, lon0 = meta["center"]
    b = meta["bounds"]

    arr, n = load_hgt(HGT)
    arr = np.where(np.isnan(arr), np.nanmedian(arr), arr)

    kx = 111320.0 * math.cos(math.radians(lat0))
    kz = 110574.0

    minX = b["minX"] - args.margin
    maxX = b["maxX"] + args.margin
    minZ = b["minZ"] - args.margin
    maxZ = b["maxZ"] + args.margin
    nx = int(math.ceil((maxX - minX) / args.res)) + 1
    nz = int(math.ceil((maxZ - minZ) / args.res)) + 1

    xs = minX + np.arange(nx) * args.res
    zs = minZ + np.arange(nz) * args.res
    X, Z = np.meshgrid(xs, zs)

    # 局部米制 → 经纬度
    lat = lat0 - Z / kz
    lon = lon0 + X / kx

    h = sample(arr, n, lat, lon)
    h = box_blur(h, passes=2)          # 抹掉 30 m 数据的台阶感
    h = np.round(h).astype(int)

    # 校园内地形的真实范围，写进 meta 供前端取景
    inside = ((X > b["minX"]) & (X < b["maxX"]) & (Z > b["minZ"]) & (Z < b["maxZ"]))
    hmin, hmax = int(h[inside].min()), int(h[inside].max())

    data["terrain"] = {
        "res": args.res,
        "minX": round(minX, 1),
        "minZ": round(minZ, 1),
        "nx": nx,
        "nz": nz,
        "h": h.ravel().tolist(),
    }
    meta["elevation"] = {"min": hmin, "max": hmax, "relief": hmax - hmin, "source": "SRTM 1 arc-second"}

    OUT.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"terrain {nx}×{nz} @ {args.res} m, 高差 {hmin}–{hmax} m ({hmax - hmin} m)")
    print(f"campus.json {OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
