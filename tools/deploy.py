#!/usr/bin/env python3
"""把本目录发布到 GitHub（走 api.github.com，不依赖 git 协议）。

用法：
    GITHUB_TOKEN=xxx python tools/deploy.py [--repo cqu-campus-a-3d] [--owner wcnz-coder]

做的事：
 1. 校验 token（/user）
 2. 仓库不存在则创建（public）
 3. 用 Git Data API 一次性提交整棵树（blobs → tree → commit → ref）
 4. 开启 GitHub Pages（main 分支根目录）

为什么不用 git push：当前网络到 github.com:443 会断流，而 api.github.com 正常。
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://api.github.com"
ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", "node_modules", "__pycache__", ".idea", ".vscode"}
SKIP_FILES = {"raw_osm_a.json", "plan_check.png"}
SKIP_EXT = {".log"}
SKIP_PREFIX = ("shot", )  # 所有截图都不上传
SKIP_NAMES = {".nojekyll"}
MAX_FILE = 40 * 1024 * 1024


def call(method, path, payload=None, token=None, raw=False):
    url = path if path.startswith("http") else API + path
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "cqu-a-3d-deploy")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            body = r.read()
            return r.status, (body if raw else (json.loads(body) if body else None))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        return e.code, {"error": body[:600]}


def collect():
    """只上传站点真正需要的东西：页面、源码、数据、预览图、工具脚本。

    data/ 下都是中间产物（SRTM 原始 HGT 25 MB、瓦片、拼接大图），不传。
    """
    KEEP_DIRS = {"src", "vendor", "public", "tools"}
    KEEP_DOCS = {"preview-day.png", "preview-night.png"}
    KEEP_ROOT = {"index.html", "favicon.svg", "README.md", "LICENSE",
                 "cqu-a-3d.html", ".nojekyll"}
    files = []
    for p in sorted(ROOT.rglob("*")):
        if p.is_dir() or not p.is_file():
            continue
        rel = p.relative_to(ROOT)
        parts = rel.parts
        if parts[0] == "docs":
            if rel.name in KEEP_DOCS:
                files.append((rel.as_posix(), p))
            continue
        if len(parts) == 1:
            if rel.name in KEEP_ROOT:
                files.append((rel.as_posix(), p))
            continue
        if parts[0] in KEEP_DIRS and not any(x in parts for x in SKIP_DIRS):
            if p.suffix.lower() in {".pyc"}:
                continue
            files.append((rel.as_posix(), p))
    return files


def main():
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        sys.exit("缺少 GITHUB_TOKEN 环境变量")

    args = sys.argv[1:]
    owner = None
    repo = "cqu-campus-a-3d"
    for i, a in enumerate(args):
        if a == "--owner":
            owner = args[i + 1]
        if a == "--repo":
            repo = args[i + 1]

    st, me = call("GET", "/user", token=token)
    if st != 200:
        sys.exit(f"token 校验失败 ({st}): {me}")
    owner = owner or me["login"]
    print(f"账号：{owner}（{me.get('name') or ''}）")

    st, r = call("GET", f"/repos/{owner}/{repo}", token=token)
    if st == 404:
        print(f"创建仓库 {owner}/{repo} …")
        st, r = call("POST", "/user/repos", {
            "name": repo,
            "description": "重庆大学 A 区（沙坪坝老校区）三维校园地图 · Three.js + OpenStreetMap",
            "homepage": f"https://{owner.lower()}.github.io/{repo}/",
            "private": False,
            "has_issues": True,
            "has_wiki": False,
            "auto_init": False,
        }, token=token)
        if st not in (200, 201):
            sys.exit(f"创建仓库失败 ({st}): {r}")
        print("  已创建")
    elif st != 200:
        sys.exit(f"读取仓库失败 ({st}): {r}")
    else:
        print("仓库已存在，覆盖提交")

    # 空仓库不能直接建 blob（409 Git Repository is empty），先用 Contents API 建一次提交
    st, ref0 = call("GET", f"/repos/{owner}/{repo}/git/ref/heads/main", token=token)
    if st != 200:   # 空仓库的 ref 查询会返回 409/404
        print("  空仓库 → 先用 Contents API 打底一次提交")
        st2, r2 = call("PUT", f"/repos/{owner}/{repo}/contents/README.md", {
            "message": "init",
            "content": base64.b64encode(b"# cqu-campus-a-3d" + bytes([10])).decode(),
        }, token=token)
        if st2 not in (200, 201):
            sys.exit(f"打底提交失败 ({st2}): {r2}")

    files = collect()
    print(f"准备上传 {len(files)} 个文件…")

    blobs = []
    for rel, path in files:
        content = base64.b64encode(path.read_bytes()).decode()
        st, b = call("POST", f"/repos/{owner}/{repo}/git/blobs",
                     {"content": content, "encoding": "base64"}, token=token)
        if st not in (200, 201):
            sys.exit(f"上传 {rel} 失败 ({st}): {b}")
        blobs.append({"path": rel, "mode": "100644", "type": "blob", "sha": b["sha"]})
        print(f"  + {rel} ({path.stat().st_size // 1024} KB)")

    st, tree = call("POST", f"/repos/{owner}/{repo}/git/trees",
                    {"tree": blobs}, token=token)
    if st not in (200, 201):
        sys.exit(f"建树失败 ({st}): {tree}")

    st, ref = call("GET", f"/repos/{owner}/{repo}/git/ref/heads/main", token=token)
    parents = [ref["object"]["sha"]] if st == 200 else []

    st, commit = call("POST", f"/repos/{owner}/{repo}/git/commits", {
        "message": "重庆大学 A 区三维校园地图：OSM 数据管线 + Three.js 实时渲染",
        "tree": tree["sha"],
        "parents": parents,
    }, token=token)
    if st not in (200, 201):
        sys.exit(f"提交失败 ({st}): {commit}")

    if parents:
        st, _ = call("PATCH", f"/repos/{owner}/{repo}/git/refs/heads/main",
                     {"sha": commit["sha"], "force": True}, token=token)
    else:
        st, _ = call("POST", f"/repos/{owner}/{repo}/git/refs",
                     {"ref": "refs/heads/main", "sha": commit["sha"]}, token=token)
    if st not in (200, 201):
        sys.exit(f"更新分支失败 ({st})")
    print(f"提交完成：{commit['sha'][:10]}")

    st, pages = call("GET", f"/repos/{owner}/{repo}/pages", token=token)
    if st == 404:
        st, pages = call("POST", f"/repos/{owner}/{repo}/pages",
                         {"source": {"branch": "main", "path": "/"}}, token=token)
        print("已开启 GitHub Pages" if st in (200, 201) else f"Pages 开启失败 ({st}): {pages}")
    else:
        print("GitHub Pages 已开启")
    print(f"\n站点（首次生效约 1 分钟）：https://{owner.lower()}.github.io/{repo}/")


if __name__ == "__main__":
    main()
