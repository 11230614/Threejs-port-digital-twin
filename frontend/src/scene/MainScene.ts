// ============================================================================
// MainScene.js —— 主场景（Main Scene：渲染环境的一站式初始化）
//
// 【这个文件干什么】
// 建立并持有 Three.js 渲染所必需的全套基础设施：
//   · scene（场景）      —— 装所有物体的容器，相当于"舞台"
//   · camera（相机）     —— 决定从哪个角度、多大视野看这个舞台
//   · renderer（渲染器） —— 真正调用 WebGL 把画面画到 canvas 上
//   · labelRenderer（标签渲染器）—— 用 HTML 元素画三维空间中的文字标注
//   · lights（灯光）     —— 一盏平行光当太阳（投影），一盏环境光提亮暗部
//   · sky（天空）        —— 基于大气散射模型的程序化天空
//   · cruiseCurve（巡航曲线）—— 相机自动巡游用的闭合样条曲线
//
// 【术语翻译】
//   Scene（场景）              Camera（相机）        Renderer（渲染器）
//   WebGL（浏览器里的三维图形接口）                   canvas（画布元素）
//   Fog（雾效，远处逐渐融入背景色，营造纵深感）
//   PerspectiveCamera（透视相机，近大远小，符合人眼观感）
//   fov（field of view，视场角，越大看得越广但畸变越明显）
//   aspect（宽高比）           near / far（近裁剪面 / 远裁剪面）
//   antialias（抗锯齿，消除边缘的阶梯状锯齿）
//   pixelRatio（设备像素比，高清屏上每个逻辑像素对应多个物理像素）
//   outputColorSpace（输出色彩空间）  SRGB（标准 RGB 色彩空间）
//   toneMapping（色调映射，把高动态范围亮度压缩到屏幕可显示范围）
//   ACESFilmic（一种电影级色调映射曲线，成像更自然）
//   exposure（曝光度）
//   shadowMap（阴影贴图）      PCFSoftShadowMap（柔和阴影算法）
//   DirectionalLight（平行光，模拟太阳，光线互相平行）
//   AmbientLight（环境光，均匀照亮全场，无方向无阴影）
//   CSS2DRenderer（把 HTML 元素定位到三维坐标上的辅助渲染器）
//   Sky（Three.js 官方的大气散射天空对象）
//   turbidity（浊度，空气中悬浮微粒的多少）
//   rayleigh（瑞利散射系数，决定天空的蓝色浓淡）
//   mie（米氏散射，决定太阳周围的光晕）
//   CatmullRomCurve3（Catmull-Rom 三维样条曲线，自动平滑穿过给定的所有点）
//   bind（绑定 this，固定函数内部 this 的指向）
// ============================================================================

import * as THREE from "three";
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";

export interface MainSceneSize { width: number; height: number }

export class MainScene {
  readonly container: HTMLElement;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly labelRenderer: CSS2DRenderer;
  readonly cruiseCurve: THREE.CatmullRomCurve3;
  readonly lookTarget: THREE.Vector3;
  readonly sun: THREE.DirectionalLight;
  readonly sunPosition: THREE.Vector3;
  private readonly _resize: () => void;

  constructor(container: HTMLElement) {
    this.container = container;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x8faec4, 2400, 8000);
    this.camera = this._setupCamera();
    this.renderer = this._setupRenderer();
    this.labelRenderer = this._setupLabels();
    this.sun = this._setupLights();
    this.sunPosition = this._setupSky();
    this.cruiseCurve = this._setupCurves();
    this.lookTarget = new THREE.Vector3(0, 30, -120);
    this._resize = this._resizeScene.bind(this);
    window.addEventListener("resize", this._resize);
  }

  private _setupCamera(): THREE.PerspectiveCamera {
    const { width, height } = this._getSize();
    const camera = new THREE.PerspectiveCamera(55, width / height, 1, 5000);
    camera.position.set(380, 220, 360);
    return camera;
  }
  private _setupRenderer(): THREE.WebGLRenderer {
    const { width, height } = this._getSize();
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 3));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.65;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(renderer.domElement);
    return renderer;
  }
  private _setupLabels(): CSS2DRenderer {
    const { width, height } = this._getSize();
    const renderer = new CSS2DRenderer();
    renderer.setSize(width, height);
    Object.assign(renderer.domElement.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    this.container.appendChild(renderer.domElement);
    return renderer;
  }
  private _setupLights(): THREE.DirectionalLight {
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(220, 380, 120); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -500, right: 500, top: 500, bottom: -500, near: 1, far: 1500 });
    sun.shadow.camera.updateProjectionMatrix();
    this.scene.add(sun, new THREE.AmbientLight(0xbfd9ff, 0.5));
    return sun;
  }
  private _setupSky(): THREE.Vector3 {
    const sky = new Sky(); sky.scale.setScalar(10000);
    const uniforms = sky.material.uniforms;
    uniforms.turbidity.value = 3; uniforms.rayleigh.value = 1; uniforms.mieCoefficient.value = 0.001; uniforms.mieDirectionalG.value = 0.1;
    const sunPosition = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(60), THREE.MathUtils.degToRad(180));
    (uniforms.sunPosition.value as THREE.Vector3).copy(sunPosition); this.scene.add(sky); return sunPosition;
  }
  private _setupCurves(): THREE.CatmullRomCurve3 {
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(-450, 90, 120), new THREE.Vector3(-450, 110, -280), new THREE.Vector3(0, 140, -360),
      new THREE.Vector3(450, 110, -280), new THREE.Vector3(450, 90, 120), new THREE.Vector3(0, 70, 220),
    ], true);
  }
  private _resizeScene(): void {
    const { width, height } = this._getSize();
    this.camera.aspect = width / height; this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height); this.labelRenderer.setSize(width, height);
  }
  private _getSize(): MainSceneSize { return { width: this.container.clientWidth || window.innerWidth, height: this.container.clientHeight || window.innerHeight }; }
  destroy(): void { window.removeEventListener("resize", this._resize); this.renderer.dispose(); this.container.innerHTML = ""; }
}
