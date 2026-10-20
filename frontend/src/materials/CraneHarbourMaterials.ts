import * as THREE from "three";

interface PaintTextureOptions {
  base: string;
  highlight: string;
  grime: string;
  rust: string;
}

interface CraneTextureSet {
  orangePaintMap: THREE.CanvasTexture;
  yellowPaintMap: THREE.CanvasTexture;
  paintRoughnessMap: THREE.CanvasTexture;
  paintNormalMap: THREE.CanvasTexture;
  rubberMap: THREE.CanvasTexture;
  rubberRoughnessMap: THREE.CanvasTexture;
  rubberNormalMap: THREE.CanvasTexture;
}

let textureSetCache: CraneTextureSet | null = null;

export function applyHarbourCraneMaterials(model: THREE.Object3D): void {
  const textures = getTextureSet();

  model.traverse((child) => {
    if (!isMeshObject(child)) return;

    child.castShadow = true;
    child.receiveShadow = true;

    const sourceMaterialName = Array.isArray(child.material) ? undefined : child.material.name;
    const partName = `${child.name} ${sourceMaterialName}`.toLowerCase();
    child.material = createCraneMaterial(partName, textures);
  });
}

function isMeshObject(object: THREE.Object3D): object is THREE.Mesh {
  return "isMesh" in object && object.isMesh === true;
}

function createCraneMaterial(partName: string, textures: CraneTextureSet): THREE.MeshPhysicalMaterial | THREE.MeshStandardMaterial {
  if (containsAny(partName, ["glass", "window", "cab", "窗", "玻璃"])) {
    return new THREE.MeshPhysicalMaterial({
      color: 0x8fd8ff,
      metalness: 0,
      roughness: 0.18,
      transmission: 0.18,
      transparent: true,
      opacity: 0.62,
      envMapIntensity: 1.1,
      clearcoat: 0.6,
      clearcoatRoughness: 0.08,
    });
  }

  if (containsAny(partName, ["wheel", "tire", "rubber", "cable", "rope", "wire", "轨", "轮", "缆"])) {
    return new THREE.MeshStandardMaterial({
      color: 0x1c2024,
      map: textures.rubberMap,
      normalMap: textures.rubberNormalMap,
      roughnessMap: textures.rubberRoughnessMap,
      metalness: 0.05,
      roughness: 0.78,
    });
  }

  if (containsAny(partName, ["spreader", "hook", "吊具", "钩"])) {
    return new THREE.MeshStandardMaterial({
      color: 0xd8b54c,
      map: textures.yellowPaintMap,
      roughnessMap: textures.paintRoughnessMap,
      normalMap: textures.paintNormalMap,
      metalness: 0.48,
      roughness: 0.55,
      envMapIntensity: 0.85,
    });
  }

  if (containsAny(partName, ["rail", "track", "beam", "metal", "steel", "frame", "梁", "钢"])) {
    return new THREE.MeshStandardMaterial({
      color: 0xd36b2d,
      map: textures.orangePaintMap,
      roughnessMap: textures.paintRoughnessMap,
      normalMap: textures.paintNormalMap,
      metalness: 0.42,
      roughness: 0.58,
      envMapIntensity: 0.9,
    });
  }

  return new THREE.MeshStandardMaterial({
    color: 0xd9712f,
    map: textures.orangePaintMap,
    roughnessMap: textures.paintRoughnessMap,
    normalMap: textures.paintNormalMap,
    metalness: 0.38,
    roughness: 0.62,
    envMapIntensity: 0.8,
  });
}

function getTextureSet(): CraneTextureSet {
  if (textureSetCache) return textureSetCache;

  const orangePaint = createPaintTexture({
    base: "#c8642f",
    highlight: "#f1a35a",
    grime: "#4c3428",
    rust: "#8d3b19",
  });
  const yellowPaint = createPaintTexture({
    base: "#d2aa3e",
    highlight: "#ffe08a",
    grime: "#4b3b20",
    rust: "#7d3516",
  });
  const paintRoughness = createRoughnessTexture("#c7c1b7", "#565049");
  const paintNormal = createNormalTexture("#8080ff", "#9191ff");
  const rubber = createRubberTexture();
  const rubberRoughness = createRoughnessTexture("#d6d6d6", "#777777");
  const rubberNormal = createNormalTexture("#7777ff", "#8b8bff");

  textureSetCache = {
    orangePaintMap: makeRepeatedTexture(orangePaint, 3, 3, THREE.SRGBColorSpace),
    yellowPaintMap: makeRepeatedTexture(yellowPaint, 3, 3, THREE.SRGBColorSpace),
    paintRoughnessMap: makeRepeatedTexture(paintRoughness, 3, 3),
    paintNormalMap: makeRepeatedTexture(paintNormal, 3, 3),
    rubberMap: makeRepeatedTexture(rubber, 5, 5, THREE.SRGBColorSpace),
    rubberRoughnessMap: makeRepeatedTexture(rubberRoughness, 5, 5),
    rubberNormalMap: makeRepeatedTexture(rubberNormal, 5, 5),
  };

  return textureSetCache;
}

function createPaintTexture({ base, highlight, grime, rust }: PaintTextureOptions): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 120; i += 1) {
    const gradient = ctx.createRadialGradient(
      Math.random() * canvas.width,
      Math.random() * canvas.height,
      0,
      Math.random() * canvas.width,
      Math.random() * canvas.height,
      40 + Math.random() * 220,
    );
    gradient.addColorStop(0, withAlpha(highlight, 0.08 + Math.random() * 0.13));
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  for (let i = 0; i < 180; i += 1) {
    ctx.strokeStyle = withAlpha(grime, 0.05 + Math.random() * 0.18);
    ctx.lineWidth = 1 + Math.random() * 4;
    ctx.beginPath();
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 30 + Math.random() * 150, y + (Math.random() - 0.5) * 14);
    ctx.stroke();
  }

  for (let i = 0; i < 38; i += 1) {
    const x = Math.random() * canvas.width;
    const y = Math.random() * canvas.height;
    const height = 35 + Math.random() * 180;
    const gradient = ctx.createLinearGradient(x, y, x, y + height);
    gradient.addColorStop(0, withAlpha(rust, 0.28));
    gradient.addColorStop(1, withAlpha(rust, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, 2 + Math.random() * 10, height);
  }

  ctx.fillStyle = withAlpha("#ffffff", 0.08);
  for (let y = 40; y < canvas.height; y += 128) {
    for (let x = 36; x < canvas.width; x += 128) {
      ctx.beginPath();
      ctx.arc(x, y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return canvas;
}

function createRoughnessTexture(light: string, dark: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 9000; i += 1) {
    ctx.fillStyle = Math.random() > 0.5 ? withAlpha(dark, 0.16) : withAlpha("#ffffff", 0.1);
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
  }

  return canvas;
}

function createNormalTexture(base: string, raised: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = withAlpha(raised, 0.28);
  for (let i = 0; i < 180; i += 1) {
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    const y = Math.random() * canvas.height;
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y + (Math.random() - 0.5) * 10);
    ctx.stroke();
  }

  return canvas;
}

function createRubberTexture(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#15181b";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < 7000; i += 1) {
    const value = 28 + Math.floor(Math.random() * 36);
    ctx.fillStyle = `rgba(${value},${value + 2},${value + 4},0.42)`;
    ctx.fillRect(Math.random() * canvas.width, Math.random() * canvas.height, 1, 1);
  }

  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  for (let y = 0; y < canvas.height; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y + 4);
    ctx.stroke();
  }

  return canvas;
}

function makeRepeatedTexture(
  canvas: HTMLCanvasElement,
  repeatX: number,
  repeatY: number,
  colorSpace: THREE.ColorSpace = THREE.NoColorSpace,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 8;
  texture.colorSpace = colorSpace;
  return texture;
}

function containsAny(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

function withAlpha(hex: string, alpha: number): string {
  const color = new THREE.Color(hex);
  return `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${alpha})`;
}
