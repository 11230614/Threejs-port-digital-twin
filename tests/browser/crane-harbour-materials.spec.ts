import { test, expect } from "@playwright/test";

test("CraneHarbourMaterials shares cached textures across models without transferring cache ownership", async ({ page, baseURL }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const response = await page.goto(baseURL ?? "http://127.0.0.1:5173", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const result = await page.evaluate(async () => {
    const THREE = await import("/node_modules/three/build/three.module.js");
    const { applyHarbourCraneMaterials } = await import("/src/materials/CraneHarbourMaterials.ts");
    const makeModel = () => {
      const model = new THREE.Group();
      const glass = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ name: "glass" }));
      const wheel = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ name: "wheel" }));
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ name: "rail" }));
      const spreader = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ name: "spreader" }));
      glass.name = "glass";
      wheel.name = "wheel";
      rail.name = "rail";
      spreader.name = "spreader";
      model.add(glass, wheel, rail, spreader);
      return { model, glass, wheel, rail, spreader };
    };
    const first = makeModel();
    const second = makeModel();
    applyHarbourCraneMaterials(first.model);
    const firstMaterials = [first.glass.material, first.wheel.material, first.rail.material, first.spreader.material]
      .filter((value): value is THREE.Material => Boolean(value));
    const firstWheelMap = (first.wheel.material as THREE.MeshStandardMaterial).map;
    const firstRailMap = (first.rail.material as THREE.MeshStandardMaterial).map;

    applyHarbourCraneMaterials(second.model);
    const secondMaterials = [second.glass.material, second.wheel.material, second.rail.material, second.spreader.material]
      .filter((value): value is THREE.Material => Boolean(value));
    const textureValues = [...firstMaterials, ...secondMaterials].flatMap((material) => [
      (material as THREE.MeshStandardMaterial).map,
      (material as THREE.MeshStandardMaterial).normalMap,
      (material as THREE.MeshStandardMaterial).roughnessMap,
    ].filter((value): value is THREE.Texture => Boolean(value)));
    const canvasTextures = textureValues.filter((texture) => Boolean(texture.isTexture && texture.image && "width" in texture.image));
    const uniqueCanvasTextures = [...new Set(canvasTextures)];
    const canvasSizes = uniqueCanvasTextures.map((texture) => ({ width: texture.image.width, height: texture.image.height }));
    const canvasPixelDataIsReadable = uniqueCanvasTextures.map((texture) => {
      const canvas = texture.image;
      if (!(canvas instanceof HTMLCanvasElement)) return false;
      const context = canvas.getContext("2d");
      return context !== null && context.getImageData(0, 0, 1, 1).data.length === 4;
    });

    // Reapplying replaces per-mesh materials but must reuse the module-owned texture cache.
    const firstMaterialsBeforeReapply = [first.glass.material, first.wheel.material, first.rail.material, first.spreader.material];
    applyHarbourCraneMaterials(first.model);
    const firstMaterialsAfterReapply = [first.glass.material, first.wheel.material, first.rail.material, first.spreader.material]
      .filter((value): value is THREE.Material => Boolean(value));
    const firstWheelMapAfterReapply = (first.wheel.material as THREE.MeshStandardMaterial).map;
    const firstRailMapAfterReapply = (first.rail.material as THREE.MeshStandardMaterial).map;

    // Legacy fallback: when classification depends only on the source material name,
    // replacing that material removes the name used by the next invocation.
    const materialNameOnly = new THREE.Group();
    const unnamedWheel = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ name: "wheel" }));
    materialNameOnly.add(unnamedWheel);
    applyHarbourCraneMaterials(materialNameOnly);
    const fallbackFirstMaterial = unnamedWheel.material as THREE.MeshStandardMaterial;
    const fallbackFirstMap = fallbackFirstMaterial.map;
    applyHarbourCraneMaterials(materialNameOnly);
    const fallbackSecondMaterial = unnamedWheel.material as THREE.MeshStandardMaterial;
    const materialNameFallbackChangesOnReapply = fallbackSecondMaterial.map !== fallbackFirstMap;

    // Disposing one model's replaced materials must not dispose cache textures still used by another.
    firstMaterials.forEach((material) => material.dispose());
    first.model.removeFromParent();
    const rendererCanvas = document.createElement("canvas");
    rendererCanvas.width = 64;
    rendererCanvas.height = 64;
    const renderer = new THREE.WebGLRenderer({ canvas: rendererCanvas, antialias: false });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 20);
    camera.position.set(0, 0, 6);
    scene.add(second.model);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2));
    renderer.render(scene, camera);
    const calls = renderer.info.render.calls;

    secondMaterials.forEach((material) => material.dispose());
    firstMaterialsAfterReapply.forEach((material) => material.dispose());
    fallbackFirstMaterial.dispose();
    fallbackSecondMaterial.dispose();
    // Cached CanvasTextures intentionally remain alive: this module exposes no cache teardown API.
    for (const model of [first.model, second.model, materialNameOnly]) model.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
    });
    renderer.dispose();
    renderer.forceContextLoss?.();
    return {
      materialTypes: secondMaterials.map((material) => material.type),
      uniqueCanvasTextureCount: new Set(canvasTextures).size,
      canvasSizes,
      canvasPixelDataIsReadable,
      rendererCalls: calls,
      glassTransparent: (second.glass.material as THREE.MeshPhysicalMaterial).transparent,
      wheelHasMap: Boolean((second.wheel.material as THREE.MeshStandardMaterial).map),
      railHasMap: Boolean((second.rail.material as THREE.MeshStandardMaterial).map),
      spreaderHasMap: Boolean((second.spreader.material as THREE.MeshStandardMaterial).map),
      wheelTextureSharedAcrossModels: firstWheelMap === (second.wheel.material as THREE.MeshStandardMaterial).map,
      railTextureSharedAcrossModels: firstRailMap === (second.rail.material as THREE.MeshStandardMaterial).map,
      wheelTextureSurvivesFirstModelReapply: firstWheelMapAfterReapply === (second.wheel.material as THREE.MeshStandardMaterial).map,
      railTextureSurvivesFirstModelReapply: firstRailMapAfterReapply === (second.rail.material as THREE.MeshStandardMaterial).map,
      wheelTextureStableOnReapply: firstWheelMapAfterReapply === firstWheelMap,
      railTextureStableOnReapply: firstRailMapAfterReapply === firstRailMap,
      materialsReplacedOnReapply: firstMaterialsAfterReapply.every((material, index) => material !== firstMaterialsBeforeReapply[index]),
      materialNameFallbackChangesOnReapply,
    };
  });

  expect(result.materialTypes).toEqual(["MeshPhysicalMaterial", "MeshStandardMaterial", "MeshStandardMaterial", "MeshStandardMaterial"]);
  expect(result.uniqueCanvasTextureCount).toBe(7);
  expect(result.canvasSizes.filter((size) => size.width === 1024 && size.height === 1024)).toHaveLength(2);
  expect(result.canvasSizes.filter((size) => size.width === 512 && size.height === 512)).toHaveLength(5);
  expect(result.canvasPixelDataIsReadable.every(Boolean)).toBe(true);
  expect(result.glassTransparent).toBe(true);
  expect(result.wheelHasMap).toBe(true);
  expect(result.railHasMap).toBe(true);
  expect(result.spreaderHasMap).toBe(true);
  expect(result.wheelTextureSharedAcrossModels).toBe(true);
  expect(result.railTextureSharedAcrossModels).toBe(true);
  expect(result.wheelTextureSurvivesFirstModelReapply).toBe(true);
  expect(result.railTextureSurvivesFirstModelReapply).toBe(true);
  expect(result.wheelTextureStableOnReapply).toBe(true);
  expect(result.railTextureStableOnReapply).toBe(true);
  expect(result.materialsReplacedOnReapply).toBe(true);
  expect(result.materialNameFallbackChangesOnReapply).toBe(true);
  expect(result.rendererCalls).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
