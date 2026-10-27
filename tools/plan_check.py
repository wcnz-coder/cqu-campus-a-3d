#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""campus.json -> 2D 自检平面图（Pillow），用于校验裁切与分类。"""
import json
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCENE = os.path.join(ROOT, "public", "data", "campus.json")
OUT = os.path.join(ROOT, "tools", "plan_check.png")

KIND_COLOR = {
    "teach": (222, 196, 138), "lab": (186, 205, 222), "dorm": (206, 190, 224),
    "food": (233, 190, 160), "sport": (176, 214, 176), "library": (150, 200, 190),
    "historic": (200, 140, 120), "admin": (200, 200, 208), "misc": (208, 208, 208),
}


def main():
    s = json.load(open(SCENE, encoding="utf-8"))
    b = s["meta"]["bounds"]
    pad = 40
    W, H = 1200, 1200
    sc = min((W - 2 * pad) / (b["maxX"] - b["minX"]), (H - 2 * pad) / (b["maxZ"] - b["minZ"]))

    def P(x, z):
        return (pad + (x - b["minX"]) * sc, pad + (z - b["minZ"]) * sc)

    img = Image.new("RGB", (W, H), (24, 32, 26))
    d = ImageDraw.Draw(img, "RGBA")
    try:
        f = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 11)
        fb = ImageFont.truetype("C:/Windows/Fonts/msyhbd.ttc", 15)
    except Exception:
        f = fb = ImageFont.load_default()

    for g in s["greens"]:
        d.polygon([P(*p) for p in g["poly"]], fill=(46, 84, 52))
    for r in s["roads"]:
        w = max(1.2, r["w"] * sc)
        d.line([P(*p) for p in r["pts"]], fill=(120, 120, 128), width=int(w))
    for w in s["water"]:
        d.polygon([P(*p) for p in w["poly"]], fill=(56, 104, 150))
    for p in s["pitches"]:
        d.polygon([P(*p) for p in p["poly"]], fill=(70, 120, 74), outline=(140, 180, 140))

    for t in s["trees"]:
        x, y = P(t[0], t[1])
        d.ellipse([x - 2, y - 2, x + 2, y + 2], fill=(60, 140, 80))

    placed = []
    for bd in sorted(s["buildings"], key=lambda k: -k["area"]):
        col = KIND_COLOR.get(bd["kind"], (200, 200, 200))
        d.polygon([P(*p) for p in bd["poly"]], fill=col + (235,), outline=(20, 20, 20))
        if not bd["name"]:
            continue
        cx, cy = P(*bd["c"])
        txt = bd["name"]
        tw = d.textlength(txt, font=f)
        box = (cx - tw / 2, cy - 7, cx + tw / 2, cy + 7)
        if any(box[0] < b[2] and b[0] < box[2] and box[1] < b[3] and b[1] < box[3] for b in placed):
            continue
        placed.append(box)
        d.text((box[0], cy - 6), txt, font=f, fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))

    d.polygon([P(*p) for p in s["boundary"]], outline=(240, 220, 120))
    m = s["meta"]
    d.text((pad, 12), "A区自检图  %d 栋 / %d 路 / 面积 %.0f m²" %
           (m["counts"]["buildings"], m["counts"]["roads"], m["area"]), font=fb, fill=(240, 240, 240))
    # 比例尺 100m
    x0, y0 = pad, H - 24
    d.line([x0, y0, x0 + 100 * sc, y0], fill=(230, 230, 230), width=3)
    d.text((x0, y0 - 16), "100 m", font=f, fill=(230, 230, 230))
    img.save(OUT)
    print("->", OUT)


if __name__ == "__main__":
    main()
