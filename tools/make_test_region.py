#!/usr/bin/env python3
"""造一个测试用 .mca（最小 Anvil 存档），用来验证 mca2web.py 的解析/合并是否正确。
不依赖 Minecraft，纯手写 NBT。"""
import zlib
import math
import pathlib
import struct

TAG = {"byte": 1, "short": 2, "int": 3, "long": 4, "float": 5, "double": 6,
       "string": 8, "list": 9, "compound": 10, "longs": 12, "ints": 11}


def s(v: str) -> bytes:
    b = v.encode()
    return struct.pack(">H", len(b)) + b


def comp(name: str, body: bytes) -> bytes:
    return struct.pack(">b", TAG["compound"]) + s(name) + body + struct.pack(">b", 0)


def i32(name: str, v: int) -> bytes:
    return struct.pack(">b", TAG["int"]) + s(name) + struct.pack(">i", v)


def str_(name: str, v: str) -> bytes:
    return struct.pack(">b", TAG["string"]) + s(name) + s(v)


def lst(name: str, item_tag: int, items: list) -> bytes:
    out = struct.pack(">b", TAG["list"]) + s(name) + struct.pack(">b", item_tag) + struct.pack(">i", len(items))
    return out + b"".join(items)


def compound_item(body: bytes) -> bytes:
    return body + struct.pack(">b", 0)


def longs(name: str, arr: list) -> bytes:
    out = struct.pack(">b", TAG["longs"]) + s(name) + struct.pack(">i", len(arr))
    return out + b"".join(struct.pack(">q", v) for v in arr)


def pack_bits(idx: list, bits: int) -> list:
    per = 64 // bits
    out = []
    cur = 0
    n = 0
    for v in idx:
        cur |= (v & ((1 << bits) - 1)) << (n * bits)
        n += 1
        if n == per:
            out.append(cur)
            cur, n = 0, 0
    if n:
        out.append(cur)
    return out


def build_chunk(cx, cz, palette_names):
    """3×16×16 的「楼」：地板 + 三层墙 + 玻璃顶，方便看合并效果。"""
    pal = [{"Name": "minecraft:air"}] + [{"Name": n} for n in palette_names]
    bits = max(4, (len(pal) - 1).bit_length())
    idx = [0] * 4096

    def put(x, y, z, pi):
        idx[(y % 16) * 256 + z * 16 + x] = pi

    stone = 1
    plank = 2
    glass = 3
    for x in range(16):
        for z in range(16):
            put(x, 0, z, stone)          # 地基
            for y in (4, 8, 12):
                put(x, y, z, plank)      # 楼板
    for x in range(16):
        for z in range(16):
            if x in (0, 15) or z in (0, 15):
                for y in range(1, 14):
                    if y % 4:
                        put(x, y, z, plank)   # 外墙
    for x in range(1, 15):
        for z in range(1, 15):
            put(x, 15, z, glass)          # 玻璃顶

    sec = b"".join([
        struct.pack(">b", TAG["byte"]) + s("Y") + struct.pack(">b", 0),
        comp("block_states", b"".join([
            lst("palette", TAG["compound"], [compound_item(b"".join([
                str_("Name", p["Name"])])) for p in pal]),
            longs("data", pack_bits(idx, bits)),
        ])),
    ])

    body = b"".join([
        i32("DataVersion", 3953),
        i32("xPos", cx),
        i32("zPos", cz),
        i32("yPos", -4),
        str_("Status", "minecraft:full"),
        lst("sections", TAG["compound"], [compound_item(sec)]),
    ])
    root = comp("", body)
    return zlib.compress(root, 6)


def build_region(path, chunks):
    table = [0] * 1024
    payload = b""
    sector = 2
    for (idx, blob) in chunks:
        length = len(blob) + 1
        need = math.ceil((length + 4) / 4096)
        table[idx] = (sector << 8) | need
        payload += struct.pack(">I", length) + b"\x02" + blob
        payload += b"\x00" * (need * 4096 - (length + 4))
        sector += need
    head = b"".join(struct.pack(">I", v) for v in table)
    path.write_bytes(head + b"\x00" * (8192 - len(head)) + payload)


if __name__ == "__main__":
    out = pathlib.Path(__file__).resolve().parent.parent / "data/test_region.mca"
    out.parent.mkdir(exist_ok=True)
    build_region(out, [(0, build_chunk(0, 0, [
        "minecraft:stone_bricks", "minecraft:oak_planks", "minecraft:glass"]))])
    print("->", out, out.stat().st_size, "bytes")
