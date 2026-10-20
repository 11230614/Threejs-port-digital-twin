import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Clock } from "../core/Clock";
import type { FrameObserver } from "../core/FrameObserver";

export type FrameObserverLike = Pick<FrameObserver, "update" | "beforeRender" | "afterRender">;
export interface RenderSystemOptions { scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; labelRenderer: { render(scene: THREE.Scene, camera: THREE.Camera): void }; cruiseCurve: THREE.CatmullRomCurve3; lookTarget: THREE.Vector3; frameObserver: FrameObserverLike }
export interface QualitySettings { pixelRatio: number; bloom: boolean }
export interface FocusEntity { getWorldPosition(target?: THREE.Vector3): THREE.Vector3 }

export class RenderSystem {
  readonly scene!: THREE.Scene; readonly camera!: THREE.PerspectiveCamera; readonly renderer!: THREE.WebGLRenderer; readonly labelRenderer!: RenderSystemOptions["labelRenderer"]; readonly cruiseCurve!: THREE.CatmullRomCurve3; readonly lookTarget!: THREE.Vector3; readonly frameObserver!: FrameObserverLike; readonly controls!: OrbitControls; readonly composer!: EffectComposer;
  private readonly clock = new Clock(); private readonly _position = new THREE.Vector3(); private readonly _resize: () => void; private rafId: number | null = null; private cruising = false; private cruiseDistance = 0; private frameCount = 0;
  constructor({ scene, camera, renderer, labelRenderer, cruiseCurve, lookTarget, frameObserver }: RenderSystemOptions) {
    if (!frameObserver) throw new Error("RenderSystem requires a FrameObserver.");
    Object.assign(this, { scene, camera, renderer, labelRenderer, cruiseCurve, lookTarget, frameObserver });
    this.controls = new OrbitControls(camera, renderer.domElement); this.controls.target.set(0, 20, -80); this.controls.maxPolarAngle = Math.PI * 0.49; this.controls.minDistance = 20; this.controls.maxDistance = 1200; this.controls.enableDamping = true;
    this.composer = new EffectComposer(renderer); this.composer.addPass(new RenderPass(scene, camera)); this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.55, 0.7, 0.45)); this.composer.addPass(new OutputPass());
    this._resize = this._resizeScene.bind(this); window.addEventListener("resize", this._resize);
  }
  setCruising(enabled: boolean): void { this.cruising = enabled; this.controls.enabled = !enabled; }
  applyQuality({ pixelRatio, bloom }: QualitySettings): void { this.renderer.setPixelRatio(pixelRatio); const pass = this.composer.passes.find((item) => item instanceof UnrealBloomPass); if (pass) pass.enabled = Boolean(bloom); }
  focusOnEntity(entity: FocusEntity | null | undefined): void { if (!entity?.getWorldPosition) return; this.setCruising(false); const target = entity.getWorldPosition(); const offset = new THREE.Vector3(95, 75, 105); this.controls.target.copy(target); this.camera.position.copy(target).add(offset); this.camera.lookAt(target); this.controls.update(); }
  start(): void { if (this.rafId !== null) return; const animate = (): void => { this.rafId = requestAnimationFrame(animate); const { deltaTime: dt, elapsedTime } = this.clock.tick(); this.frameObserver.update(dt, elapsedTime); this.frameObserver.beforeRender(); this.composer.render(); this.frameObserver.afterRender(); this.frameCount += 1; if (import.meta.env.DEV && typeof window !== "undefined" && this.frameCount % 30 === 0) window.dispatchEvent(new CustomEvent("runtime-frame", { detail: { frameCount: this.frameCount, elapsedTime, renderer: { calls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, points: this.renderer.info.render.points } } })); }; animate(); }
  stop(): void { if (this.rafId !== null) cancelAnimationFrame(this.rafId); this.rafId = null; window.removeEventListener("resize", this._resize); this.controls.dispose(); this.composer.dispose(); this.clock.reset(); }
  updateCamera(dt: number): void { if (!this.cruising) { if (this.controls.enabled) this.controls.update(); return; } const length = this.cruiseCurve.getLength(); this.cruiseDistance = (this.cruiseDistance + dt * 26) % length; this.cruiseCurve.getPointAt(this.cruiseDistance / length, this._position); this.camera.position.copy(this._position); this.camera.lookAt(this.lookTarget); }
  private _resizeScene(): void { const width = this.renderer.domElement.parentElement?.clientWidth || window.innerWidth; const height = this.renderer.domElement.parentElement?.clientHeight || window.innerHeight; this.composer.setSize(width, height); }
}
