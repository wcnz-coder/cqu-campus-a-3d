#!/usr/bin/env python3
"""把整个站点打包成一个可以双击打开的 HTML（file:// 也能跑）。

用法：
    python tools/make_standalone.py            # 需要先 npm i -D esbuild
产物：
    cqu-a-3d.html   （约 1.5 MB，内含 three.js、数据与样式）
"""
import base64
import json
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "cqu-a-3d.html"
BUNDLE = ROOT / "bundle.js"


def build_bundle() -> str:
    npx = "npx.cmd" if sys.platform.startswith("win") else "npx"
    subprocess.run(
        [npx, "esbuild", "src/main.js", "--bundle", "--format=iife", "--minify",
         "--alias:three=./vendor/three.module.js",
         "--alias:three/addons/OrbitControls.js=./vendor/OrbitControls.js",
         "--outfile=bundle.js"],
        cwd=ROOT, check=True, shell=sys.platform.startswith("win"),
    )
    return BUNDLE.read_text(encoding="utf-8")


def main() -> None:
    js = build_bundle()
    css = (ROOT / "src/style.css").read_text(encoding="utf-8")
    data = json.loads((ROOT / "public/data/campus.json").read_text(encoding="utf-8"))
    html = (ROOT / "index.html").read_text(encoding="utf-8")

    # 内联样式
    html = html.replace(
        '<link rel="stylesheet" href="./src/style.css" />',
        "<style>\n" + css + "\n</style>",
    )
    # 内联数据 + 打包后的逻辑，去掉 importmap 与模块入口
    html = re.sub(
        r'<script type="importmap">.*?</script>\s*',
        "",
        html,
        flags=re.S,
    )
    # 卫星底图也需要内联，否则 file:// 下拿不到图片
    sat = ROOT / "public/data/sat_ground.jpg"
    sat_js = ""
    if sat.exists():
        b64 = base64.b64encode(sat.read_bytes()).decode("ascii")
        sat_js = ('<script>window.__SAT__="data:image/jpeg;base64,'
                  + b64 + '";</script>\n')

    payload = (
        sat_js
        + "<script>window.__CAMPUS__=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";</script>\n"
        "<script>\n" + js + "\n</script>"
    )
    html = html.replace('<script type="module" src="./src/main.js"></script>', payload)

    OUT.write_text(html, encoding="utf-8")
    BUNDLE.unlink(missing_ok=True)
    print(f"standalone -> {OUT}  ({OUT.stat().st_size/1024/1024:.2f} MB)")


if __name__ == "__main__":
    main()
