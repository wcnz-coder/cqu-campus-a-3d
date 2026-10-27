#!/usr/bin/env python3
"""把 BlueMap 的 markers.json（像素重大在线地图的兴趣点）换算成我们场景里的坐标。

用法:
    python tools/mc_markers.py markers.json

原理：你给的点里有名字（主教学楼、五教、八教……），我这边 campus.json 里也有同名建筑。
用同名点做最小二乘，求出「MC 世界坐标 → 本场景米制坐标」的相似变换（旋转+缩放+平移），
再把所有点（包括我们没建的东西，比如钟塔、正大门）落到图上。有了这个，就能把
他们的建筑位置/朝向直接对齐过来，而不是靠我猜。
"""
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA = ROOT / "public/data/campus.json"


def parse_markers(raw):
    """兼容 BlueMap 5.x 的 markers.json 结构。"""
    out = []
    data = raw.get("data") if isinstance(raw, dict) else None
    sets = []
    if isinstance(data, dict):
        sets = data.get("markerSets") or []
    elif isinstance(raw, list):
        sets = raw
    for st in sets:
        for m in st.get("markers", []):
            pos = m.get("position") or {}
            if "x" not in pos:
                continue
            out.append({
                "label": (m.get("label") or m.get("name") or "").strip(),
                "x": float(pos["x"]),
                "z": float(pos["z"]),
                "y": float(pos.get("y", 0)),
                "detail": m.get("detail") or "",
            })
    return out


def norm(s):
    return (s.replace("重庆大学", "").replace("A区", "").replace(" ", "")
            .replace("（", "(").replace("）", ")").strip())


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    raw = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
    pts = parse_markers(raw)
    print(f"markers: {len(pts)} 个")
    for p in pts[:20]:
        print(f"  {p['label']:24s} x={p['x']:8.1f} z={p['z']:8.1f} y={p['y']:.0f}")

    ours = json.loads(DATA.read_text(encoding="utf-8"))
    by_name = {}
    for b in ours["buildings"]:
        n = b.get("name")
        if n:
            by_name.setdefault(norm(n), b["c"])

    pairs = []
    for p in pts:
        c = by_name.get(norm(p["label"]))
        if c:
            pairs.append((p["x"], p["z"], c[0], c[1], p["label"]))
    print(f"\n同名可对齐: {len(pairs)} 组")
    for a in pairs:
        print(f"  {a[4]}: MC({a[0]:.0f},{a[1]:.0f}) -> 本场景({a[2]:.0f},{a[3]:.0f})")
    if len(pairs) < 2:
        print("\n少于 2 组同名点，无法解算变换。把 markers.json 整个发我，我手工配对。")
        return

    # 最小二乘求相似变换： [x'] = s*R*[x] + t
    n = len(pairs)
    mx = sum(p[0] for p in pairs) / n
    mz = sum(p[1] for p in pairs) / n
    ux = sum(p[2] for p in pairs) / n
    uz = sum(p[3] for p in pairs) / n
    num_re = num_im = den = 0.0
    for x, z, u, v, _ in pairs:
        a, b = x - mx, z - mz
        c, d = u - ux, v - uz
        num_re += a * c + b * d
        num_im += a * d - b * c
        den += a * a + b * b
    s = math.hypot(num_re, num_im) / den if den else 1.0
    th = math.atan2(num_im, num_re)
    tx = ux - s * (math.cos(th) * mx - math.sin(th) * mz)
    tz = uz - s * (math.sin(th) * mx + math.cos(th) * mz)
    rms = 0.0
    for x, z, u, v, _ in pairs:
        px = s * (math.cos(th) * x - math.sin(th) * z) + tx
        pz = s * (math.sin(th) * x + math.cos(th) * z) + tz
        rms += (px - u) ** 2 + (pz - v) ** 2
    rms = math.sqrt(rms / n)

    print(f"\n变换: scale={s:.4f} rot={math.degrees(th):.2f}° t=({tx:.1f},{tz:.1f})  RMS={rms:.1f} m")
    out = []
    for p in pts:
        px = s * (math.cos(th) * p["x"] - math.sin(th) * p["z"]) + tx
        pz = s * (math.sin(th) * p["x"] + math.cos(th) * p["z"]) + tz
        out.append({"label": p["label"], "x": round(px, 1), "z": round(pz, 1), "y": p["y"],
                    "detail": p["detail"]})
    dst = ROOT / "data/mc_markers_aligned.json"
    dst.write_text(json.dumps({"transform": {"scale": s, "rot": math.degrees(th),
                                             "t": [tx, tz], "rms": rms}, "points": out},
                              ensure_ascii=False, indent=1), encoding="utf-8")
    print("->", dst)


if __name__ == "__main__":
    main()
