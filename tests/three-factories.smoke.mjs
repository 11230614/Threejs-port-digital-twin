import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});

try {
  const { ProxyFactory } = await vite.ssrLoadModule("/src/rendering/ProxyFactory.ts");
  const { LowDetailFactory } = await vite.ssrLoadModule("/src/rendering/LowDetailFactory.ts");

  const parent = new THREE.Group();
  parent.position.set(10, 2, -4);
  const source = new THREE.Mesh(
    new THREE.BoxGeometry(4, 2, 6),
    new THREE.MeshStandardMaterial({ color: 0x112233 }),
  );
  source.position.set(2, 1, 3);
  parent.add(source);
  const proxy = ProxyFactory.createObjectProxy({ source, parent, name: "proxy", attach: true });
  assert.equal(proxy.name, "proxy");
  assert.equal(proxy.userData.lodProxy, true);
  assert.equal(proxy.visible, false);
  assert.equal(parent.children.includes(proxy), true);
  assert.deepEqual(proxy.geometry.parameters, { width: 4, height: 2, depth: 6, widthSegments: 1, heightSegments: 1, depthSegments: 1 });

  const areaParent = new THREE.Group();
  const area = ProxyFactory.createAreaProxy({
    scene: areaParent,
    bounds: new THREE.Box3(new THREE.Vector3(-3, -1, -2), new THREE.Vector3(5, 0, 4)),
    attach: false,
  });
  assert.equal(areaParent.children.length, 0);
  assert.equal(area.position.x, 1);
  assert.equal(area.position.y, 0.06);
  assert.equal(area.position.z, 1);

  assert.throws(() => ProxyFactory.createObjectProxy({ source: {}, parent }), TypeError);
  assert.throws(() => ProxyFactory.createAreaProxy({ scene: areaParent, bounds: new THREE.Box3() }), TypeError);

  const lowDetail = LowDetailFactory.createObject({ source, parent, name: "low", ratio: 0.5 });
  assert.equal(lowDetail.name, "low");
  assert.equal(lowDetail.visible, false);
  assert.equal(lowDetail.userData.lowDetail, true);
  assert.ok(lowDetail.geometry.boundingBox, "low-detail geometry has bounds");

  const fallback = LowDetailFactory.createObject({ source, parent, maxInputVertices: 1 });
  assert.ok(fallback.geometry.boundingBox, "box fallback has bounds");
  assert.throws(() => LowDetailFactory.createObject({ source: {}, parent }), TypeError);
  console.log("Three.js factory behavior checks passed (proxy bounds, attachment, validation, low-detail fallback).");
} finally {
  await vite.close();
}
