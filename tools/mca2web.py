#!/usr/bin/env python3
"""把 Minecraft 存档（Anvil .mca）转成网页能直接吃的模型文件 .mcb

思路：读 region → 每个 section 的 palette + packed longs → 体素 → 按同色做
「每层 2D 贪心合并」成盒子 → 写紧凑二进制（每盒 15 字节）。网页端用
InstancedMesh 一次性画几万个盒子，比逐方块快两个数量级。

用法：
    python tools/mca2web.py <region.mca> <out.mcb> [--min-y 40 --max-y 120]

谁用得上：像素重大（CQUcraft）的世界存档 / Bobby 模组缓存 / 自己造的存档，
都能在几分钟内变成可以旋转、缩放、点选的网页模型。
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
import pathlib
import struct
import zlib
from collections import defaultdict

# ---------------------------------------------------------------- NBT 读取

TAG_END, TAG_BYTE, TAG_SHORT, TAG_INT, TAG_LONG = 0, 1, 2, 3, 4
TAG_FLOAT, TAG_DOUBLE, TAG_BYTES, TAG_STRING = 5, 6, 7, 8
TAG_LIST, TAG_COMPOUND, TAG_INTS, TAG_LONGS = 9, 10, 11, 12


class NBT:
    def __init__(self, buf: bytes):
        self.b = buf
        self.i = 0

    def u(self, fmt, n):
        v = struct.unpack_from(fmt, self.b, self.i)[0]
        self.i += n
        return v

    def string(self):
        n = self.u(">H", 2)
        s = self.b[self.i:self.i + n].decode("utf-8", "replace")
        self.i += n
        return s

    def payload(self, t):
        if t == TAG_BYTE:
            return self.u(">b", 1)
        if t == TAG_SHORT:
            return self.u(">h", 2)
        if t == TAG_INT:
            return self.u(">i", 4)
        if t == TAG_LONG:
            return self.u(">q", 8)
        if t == TAG_FLOAT:
            return self.u(">f", 4)
        if t == TAG_DOUBLE:
            return self.u(">d", 8)
        if t == TAG_BYTES:
            n = self.u(">i", 4)
            v = self.b[self.i:self.i + n]
            self.i += n
            return v
        if t == TAG_STRING:
            return self.string()
        if t == TAG_LIST:
            it = self.u(">b", 1)
            n = self.u(">i", 4)
            return [self.payload(it) for _ in range(n)]
        if t == TAG_COMPOUND:
            out = {}
            while True:
                tt = self.u(">b", 1)
                if tt == TAG_END:
                    return out
                name = self.string()
                out[name] = self.payload(tt)
        if t == TAG_INTS:
            n = self.u(">i", 4)
            v = struct.unpack_from(f">{n}i", self.b, self.i)
            self.i += 4 * n
            return list(v)
        if t == TAG_LONGS:
            n = self.u(">i", 4)
            v = struct.unpack_from(f">{n}q", self.b, self.i)
            self.i += 8 * n
            return list(v)
        raise ValueError(f"unknown tag {t} at {self.i}")


def read_region(path: pathlib.Path):
    raw = path.read_bytes()
    chunks = []
    for idx in range(1024):
        off = struct.unpack_from(">I", raw, idx * 4)[0]
        if off == 0:
            continue
        start = (off >> 8) * 4096
        length = struct.unpack_from(">I", raw, start)[0]
        comp = raw[start + 4]
        blob = raw[start + 5:start + 4 + length]
        data = None
        for dec in ((gzip.decompress, zlib.decompress) if comp != 1 else (gzip.decompress, zlib.decompress)):
            try:
                data = dec(blob)
                break
            except Exception:
                continue
        if data is None:
            continue
        nb = NBT(data)
        t = nb.u(">b", 1)
        if t != TAG_COMPOUND:
            continue
        nb.string()
        chunks.append(nb.payload(TAG_COMPOUND))
    return chunks


# ---------------------------------------------------------------- 方块调色板

def default_palette():
    """常见方块的「代表色」，取自游戏内大致观感；缺失的名字按名字哈希取色。"""
    return {
        "stone": (125, 125, 125), "smooth_stone": (158, 158, 158),
        "stone_bricks": (122, 121, 122), "cobblestone": (127, 127, 127),
        "diorite": (188, 188, 190), "andesite": (136, 136, 136), "granite": (150, 103, 85),
        "deepslate": (80, 80, 84), "deepslate_tiles": (55, 55, 58),
        "dirt": (134, 96, 67), "grass_block": (121, 155, 90), "podzol": (91, 64, 30),
        "sand": (219, 207, 163), "gravel": (128, 122, 118),
        "oak_planks": (162, 131, 79), "spruce_planks": (114, 84, 48),
        "birch_planks": (196, 179, 123), "dark_oak_planks": (66, 43, 20),
        "oak_log": (109, 85, 50), "spruce_log": (58, 37, 16),
        "glass": (200, 220, 230), "tinted_glass": (60, 65, 70),
        "white_concrete": (207, 213, 214), "light_gray_concrete": (125, 125, 115),
        "gray_concrete": (54, 57, 61), "black_concrete": (8, 10, 15),
        "red_concrete": (142, 32, 32), "orange_concrete": (224, 97, 0),
        "yellow_concrete": (240, 175, 21), "lime_concrete": (94, 168, 24),
        "green_concrete": (73, 91, 36), "cyan_concrete": (21, 119, 136),
        "blue_concrete": (44, 46, 143), "purple_concrete": (100, 31, 156),
        "magenta_concrete": (169, 48, 159), "pink_concrete": (213, 101, 142),
        "brown_concrete": (96, 59, 31),
        "white_terracotta": (209, 178, 161), "light_gray_terracotta": (135, 107, 98),
        "terracotta": (152, 94, 67), "bricks": (150, 97, 83),
        "quartz_block": (235, 229, 222), "smooth_quartz": (234, 229, 221),
        "iron_block": (220, 220, 220), "gold_block": (247, 213, 76),
        "water": (63, 118, 228), "lava": (207, 92, 19),
        "oak_leaves": (60, 110, 40), "spruce_leaves": (42, 78, 42),
        "birch_leaves": (110, 145, 70), "dark_oak_leaves": (40, 75, 30),
        "short_grass": (95, 159, 53), "grass": (95, 159, 53),
        "white_wool": (233, 236, 236), "light_gray_wool": (142, 142, 134),
        "gray_wool": (62, 68, 71), "black_wool": (21, 21, 26),
        "red_wool": (161, 39, 34), "blue_wool": (53, 57, 157),
        "snow_block": (249, 254, 254), "packed_ice": (141, 180, 250),
        "netherrack": (97, 38, 38), "soul_sand": (81, 62, 50),
    }


def norm_name(name: str) -> str:
    n = name.split(":")[-1]
    for suffix in ("_stairs", "_slab", "_wall", "_fence", "_pane", "_door", "_trapdoor"):
        if n.endswith(suffix):
            n = n[: -len(suffix)]
    return n


def color_of(name: str, props: dict | None, pal: dict):
    n = norm_name(name)
    if n in pal:
        return pal[n]
    for key in (n + "_planks", n + "_concrete", n + "_terracotta", n + "_wool", n + "_block"):
        if key in pal:
            return pal[key]
    h = zlib.crc32(name.encode())
    return (90 + h % 110, 90 + (h >> 8) % 110, 90 + (h >> 16) % 110)


# ---------------------------------------------------------------- 体素 → 盒子

def unpack_long_array(longs, bits, count):
    if bits <= 0:
        return []
    out = []
    per = 64 // bits
    mask = (1 << bits) - 1
    for lv in longs:
        v = lv & 0xFFFFFFFFFFFFFFFF
        for k in range(per):
            if len(out) >= count:
                return out
            out.append((v >> (k * bits)) & mask)
    return out


def chunk_voxels(chunk):
    """→ {(x,y,z): rgb}，坐标是世界坐标（section 内已加 ±16 偏移）。"""
    out = {}
    cx = chunk.get("xPos", 0) * 16
    cz = chunk.get("zPos", 0) * 16
    for sec in chunk.get("sections", []) or []:
        bs = sec.get("block_states") or sec.get("Palette")
        if not bs:
            continue
        sy = sec.get("Y", 0) * 16
        pal = bs.get("palette") or []
        data = bs.get("data")
        if not pal:
            continue
        if len(pal) == 1 and data is None:
            idx = [0] * 4096
        else:
            bits = max(4, (len(pal) - 1).bit_length())
            idx = unpack_long_array(data or [], bits, 4096)
        for i, pi in enumerate(idx):
            if pi == 0:
                continue
            ent = pal[pi] if pi < len(pal) else None
            if not ent:
                continue
            name = ent.get("Name", "")
            if name.endswith("air") or name.endswith("cave_air") or name.endswith("void_air"):
                continue
            x, y, z = i & 15, sy + (i >> 8), (i >> 4) & 15
            out[(cx + x, y, cz + z)] = name
    return out


def voxels_to_boxes(vox: dict, pal: dict, min_y=None, max_y=None):
    """按 y 分层做 2D 贪心合并：同色相邻 → 一个盒子，再把上下同尺寸的合并成高盒。"""
    layers = defaultdict(dict)
    for (x, y, z), name in vox.items():
        if min_y is not None and y < min_y:
            continue
        if max_y is not None and y > max_y:
            continue
        layers[y][(x, z)] = color_of(name, None, pal)

    flat = {}
    for y, cells in layers.items():
        done = set()
        for (x, z) in sorted(cells):
            if (x, z) in done:
                continue
            c = cells[(x, z)]
            w = 1
            while cells.get((x + w, z)) == c and (x + w, z) not in done:
                w += 1
            d = 1
            while True:
                ok = True
                for k in range(w):
                    if cells.get((x + k, z + d)) != c or (x + k, z + d) in done:
                        ok = False
                        break
                if not ok:
                    break
                d += 1
            for k in range(w):
                for m in range(d):
                    done.add((x + k, z + m))
            flat[(x, z, y)] = (w, d, c)

    # 竖向合并：同一 (x,z) 位置、同尺寸同色、y 相邻
    used = set()
    boxes = []
    for key in sorted(flat, key=lambda t: (t[2], t[1], t[0])):
        if key in used:
            continue
        x, z, y = key
        w, d, c = flat[key]
        h = 1
        while flat.get((x, z, y + h)) == (w, d, c) and (x, z, y + h) not in used:
            h += 1
        for k in range(h):
            used.add((x, z, y + k))
        boxes.append((x, y, z, w, h, d, c))
    return boxes


# ---------------------------------------------------------------- 输出

def write_mcb(path: pathlib.Path, boxes, meta):
    xs = [b[0] for b in boxes] or [0]
    zs = [b[2] for b in boxes] or [0]
    ys = [b[1] for b in boxes] or [0]
    ox, oz, oy = min(xs), min(zs), min(ys)
    with open(path, "wb") as f:
        f.write(b"MCB1")
        head = json.dumps({"origin": [ox, oy, oz], "count": len(boxes), **meta}).encode()
        f.write(struct.pack(">I", len(head)))
        f.write(head)
        for (x, y, z, w, h, d, c) in boxes:
            f.write(struct.pack(">HHHBBB", x - ox, y - oy, z - oz, min(w, 255), min(h, 255), min(d, 255)))
            f.write(bytes(c))
    return ox, oy, oz


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mca")
    ap.add_argument("out")
    ap.add_argument("--min-y", type=int, default=None)
    ap.add_argument("--max-y", type=int, default=None)
    args = ap.parse_args()

    chunks = read_region(pathlib.Path(args.mca))
    vox = {}
    for ch in chunks:
        vox.update(chunk_voxels(ch))
    pal = default_palette()
    boxes = voxels_to_boxes(vox, pal, args.min_y, args.max_y)
    o = write_mcb(pathlib.Path(args.out), boxes,
                  {"source": pathlib.Path(args.mca).name, "chunks": len(chunks)})
    print(f"{len(chunks)} chunks, {len(vox)} 方块 → {len(boxes)} 盒子, origin={o}, "
          f"{pathlib.Path(args.out).stat().st_size/1e6:.2f} MB")


if __name__ == "__main__":
    main()
