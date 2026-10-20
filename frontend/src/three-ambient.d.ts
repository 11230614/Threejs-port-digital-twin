// Project-local declarations for Three.js example modules that are imported by
// the migrated source while keeping the package's official Three.js types.
declare module "three/examples/jsm/loaders/GLTFLoader.js" {
  import type { AnimationClip, Group } from "three";
  export interface GLTF { scene: Group; scenes: Group[]; animations: AnimationClip[]; userData: Record<string, unknown> }
  export class GLTFLoader { load(url: string, onLoad: (gltf: GLTF) => void, onProgress?: (event: ProgressEvent<EventTarget>) => void, onError?: (error: unknown) => void): void }
}
declare module "three/examples/jsm/controls/OrbitControls.js" {
  import type { Camera, Vector3 } from "three";
  export class OrbitControls { constructor(object: Camera, domElement: HTMLElement); target: Vector3; enabled: boolean; maxPolarAngle: number; minDistance: number; maxDistance: number; enableDamping: boolean; update(): void; dispose(): void }
}
declare module "three/examples/jsm/postprocessing/EffectComposer.js" {
  import type { WebGLRenderer } from "three";
  export class EffectComposer { constructor(renderer: WebGLRenderer); passes: Array<{ enabled?: boolean }>; addPass(pass: { enabled?: boolean }): void; render(): void; setSize(width: number, height: number): void; setPixelRatio(value: number): void; dispose(): void }
}
declare module "three/examples/jsm/postprocessing/RenderPass.js" { import type { Camera, Scene } from "three"; export class RenderPass { constructor(scene: Scene, camera: Camera); enabled?: boolean } }
declare module "three/examples/jsm/postprocessing/OutputPass.js" { export class OutputPass { enabled?: boolean } }
declare module "three/examples/jsm/postprocessing/UnrealBloomPass.js" { import type { Vector2 } from "three"; export class UnrealBloomPass { constructor(size: Vector2, strength: number, radius: number, threshold: number); enabled: boolean } }
declare module "three/examples/jsm/renderers/CSS2DRenderer.js" { import type { Camera, Scene } from "three"; export class CSS2DRenderer { domElement: HTMLDivElement; setSize(width: number, height: number): void; render(scene: Scene, camera: Camera): void } }
declare module "three/examples/jsm/objects/Sky.js" { import type { Object3D } from "three"; export class Sky extends Object3D { material: { uniforms: Record<string, { value: unknown }> } } }
import "three";
declare module "three" {
  interface Object3D { readonly isMesh?: boolean; }
}
