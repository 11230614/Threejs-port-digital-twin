import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { HighlightSystem } = await vite.ssrLoadModule("/src/rendering/HighlightSystem.ts");
  const scene = new THREE.Scene();
  const transform = { bbox: new THREE.Box3(new THREE.Vector3(1, 2, 3), new THREE.Vector3(4, 5, 6)), updateBBox() { this.updated = true; } };
  let selected = { getComponent: () => transform };
  const system = new HighlightSystem(scene, { getSelected: () => selected });
  system.update();
  const helper = scene.children[0];
  assert.equal(helper.visible, true);
  assert.equal(transform.updated, true);
  assert.deepEqual(helper.box.min.toArray(), [1, 2, 3]);
  selected = null;
  system.update();
  assert.equal(helper.visible, false);
  selected = { getComponent: () => null };
  system.update();
  assert.equal(helper.visible, false);
  console.log("HighlightSystem behavior checks passed (selection, bbox update, visibility reset).");
} finally {
  await vite.close();
}
