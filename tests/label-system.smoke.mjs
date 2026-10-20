import assert from "node:assert/strict";
import * as THREE from "three";
import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom", optimizeDeps: { noDiscovery: true } });
try {
  const { LabelSystem } = await vite.ssrLoadModule("/src/rendering/LabelSystem.ts");
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  let updates = 0;
  let rendered = null;
  const labelSystem = new LabelSystem({
    scene,
    camera,
    labelRenderer: { render: (renderScene, renderCamera) => { rendered = [renderScene, renderCamera]; } },
    groundSystem: { updateLabels: () => { updates += 1; } },
  });
  labelSystem.update();
  assert.equal(updates, 1);
  assert.deepEqual(rendered, [scene, camera]);
  console.log("LabelSystem behavior checks passed (ground update and CSS2D render ordering).");
} finally {
  await vite.close();
}
