/* 建模：把 OSM 实轮廓做成「有体量」的建筑，而不是一块实心积木。
 *
 * 三件事：
 *  1. 大房子挖院子 —— 轮廓内缩一圈当洞，挤出后就是围合式主楼，屋顶是环形；
 *  2. 裙房 + 退台 —— 底部一圈略大的低矮裙房，主体再上去，剪影有层次；
 *  3. 女儿墙 + 屋顶设备 —— 檐口收边，远看不至于像纸片。
 *
 * 全部按真实轮廓生成，形状来自 OSM/影像，只有分层参数是人定的。
 */

const insetPoly = (poly, k, cx, cz) =>
  poly.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);

/** 把多边形做成 Shape；holes 会被挖掉（院子）。 */
function shapeWithHoles(THREE, outer, holes) {
  const shape = new THREE.Shape();
  outer.forEach(([x, z], i) => (i ? shape.lineTo(x, -z) : shape.moveTo(x, -z)));
  shape.closePath();
  (holes || []).forEach((ring) => {
    const path = new THREE.Path();
    ring.forEach(([x, z], i) => (i ? path.lineTo(x, -z) : path.moveTo(x, -z)));
    path.closePath();
    shape.holes.push(path);
  });
  return shape;
}

/** 一层挤出：从 y0 起，高度 h。 */
function slab(THREE, outer, holes, h, y0) {
  const geo = new THREE.ExtrudeGeometry(shapeWithHoles(THREE, outer, holes), {
    depth: h, bevelEnabled: false, curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, y0, 0);
  geo.computeVertexNormals();
  return geo;
}

/**
 * 生成一栋有体积感的楼。
 * @returns {{group: THREE.Group, walls: THREE.Material[], top: number}}
 */
export function buildDetailed(THREE, bd, baseY, mats) {
  const group = new THREE.Group();
  const walls = [];
  const { poly, area, h } = bd;
  const [cx, cz] = bd.c;

  const wallMat = mats.wall.clone();
  walls.push(wallMat);
  const roofMatUse = mats.roof.clone();
  const trimMat = mats.trim.clone();
  const matPair = [roofMatUse, wallMat];

  const big = area > 5200;          // 大房子：挖院
  const mid = area > 1600;          // 中大：带裙房

  // 裙房（贴地一圈，略大）
  let y = baseY;
  if (mid) {
    const skirtH = Math.min(5.5, h * 0.28);
    const skirt = slab(THREE, insetPoly(poly, 1.045, cx, cz), null, skirtH, baseY - 1.2);
    const m = new THREE.Mesh(skirt, [trimMat, wallMat]);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    y = baseY + skirtH - 1.2;
  }

  if (big) {
    // 围合式：外轮廓挖一个内院，屋顶自然成环
    const inner = insetPoly(poly, 0.68, cx, cz);
    const wallH = h - (y - baseY);
    const g = slab(THREE, poly, [inner], wallH, y);
    const m = new THREE.Mesh(g, matPair);
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
    // 院子地面
    const floorGeo = slab(THREE, insetPoly(poly, 0.66, cx, cz), null, 0.6, baseY + 0.2);
    const floor = new THREE.Mesh(floorGeo, trimMat);
    floor.receiveShadow = true;
    group.add(floor);
    // 屋顶女儿墙（沿外檐一圈，矮 0.9 m，稍内收）
    const cap = slab(THREE, insetPoly(poly, 0.985, cx, cz), [insetPoly(poly, 0.955, cx, cz)],
      0.9, y + wallH);
    const capMesh = new THREE.Mesh(cap, trimMat);
    capMesh.castShadow = true;
    group.add(capMesh);
    // 楼梯间/机房：院子一角放两个体块
    const boxN = area > 9000 ? 3 : 2;
    for (let k = 0; k < boxN; k++) {
      const s = 6 + ((bd.id + k * 5) % 4) * 2;
      const bx = cx + (k - 1) * s * 1.6;
      const bz = cz + (k % 2 ? 1 : -1) * s * 1.4;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(s, 3.2, s * 0.8),
        k % 2 ? trimMat : roofMatUse
      );
      box.position.set(bx, y + wallH + 1.6, bz);
      box.castShadow = true;
      group.add(box);
    }
    return { group, walls, top: y + wallH };
  }

  // 普通体量：主体 + 顶层收边
  const bodyH = h - (y - baseY);
  const body = slab(THREE, poly, null, bodyH, y);
  const m = new THREE.Mesh(body, matPair);
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  const cap = slab(THREE, insetPoly(poly, 0.985, cx, cz), [insetPoly(poly, 0.95, cx, cz)], 0.8, y + bodyH);
  const capMesh = new THREE.Mesh(cap, trimMat);
  capMesh.castShadow = true;
  group.add(capMesh);
  return { group, walls, top: y + bodyH };
}
