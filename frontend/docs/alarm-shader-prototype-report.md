# Alarm Shader Prototype Report

Start the local entry from `vue+three/frontend`:

```powershell
npm run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/alarm-shader-prototype.html`. The prototype stays isolated from `AlarmVisualSystem.ts`, `PortRuntime.ts`, `GpuResourcePool`, and `InstanceBatch.ts`.

## Implementation Under Test

The scene creates three ordinary meshes sharing one `SphereGeometry` and one original `MeshStandardMaterial`. An unalarmed object uses its original material reference. Alarm variants are cached as `Map<originalMaterial, Map<severity, variant>>`; a mesh switches to the cached variant for its current level, and switches back to the original reference on clear. `MeshStandardMaterial.clone()` preserves the source material properties and texture references. Variants keep their alarm level fixed in the compile closure, while their `uAlarmTime` value is updated at the beginning of each animation frame. The original shared-material object-uniform failure mode remains available with “切换共享材质失败对照”.

The shader adds the alarm tint after `<emissivemap_fragment>`, so the original emissive contribution remains. It uses the current alarm colors (severe `#ff7a2f`, urgent `#ff3333`, warning `#ffd45c`), severe/urgent pulse `0.45 + abs(sin(time * 7)) * 0.55`, and fixed warning brightness `0.72`. The page uses Three.js r185, `WebGLRenderer`, ACES tone mapping and exposure 0.65. Bloom is not included.

## Results

Observed in the local in-app browser at a 550x710 viewport. Center pixels are framebuffer `readPixels` RGB values after the corresponding render.

| Check | Status | Evidence |
|---|---|---|
| Single mesh, stable alarm variant, pulse valley vs peak | **Pass** | Severe variant: valley `195,180,176`; peak `221,202,189`. The preset values render on the same mesh and same variant. |
| Single mesh continuous rendering | **Pass** | 72 animation samples over `0.007s..0.954s` (more than two `π/7 ≈ 0.449s` pulse periods) yielded 38 unique center-pixel RGB values. First/last: `208,191,182` → `197,182,177`. The object remained on the same variant; no other visible object or material switching is needed. |
| Three-object state isolation | **Pass** | With object 1 clear, object 2 severe, object 3 urgent, normal-order pixels were `129,143,158 / 213,194,184 / 215,177,186`. Reversed render-order pixels were identical at the corresponding object positions. |
| Clear restores original appearance | **Pass** | Object 2 no-alarm baseline `134,147,162`; after severe → clear it returned to `134,147,162`. The object reference is restored to the original material. |
| Same source material + same severity reuses a variant | **Pass** | Runtime assertion returned true for two meshes at severe; both resolve to the same cached variant object. |
| Different source materials get independent variants and preserve parameters | **Pass** | Runtime assertions confirmed distinct variant identities for different source materials and copied emissive/roughness values. The second source was toggled in the UI to exercise the other cache branch. Texture object identity follows Three.js material clone semantics; a textured-source pixel comparison was not run. |
| Repeated lookup and state/clear cycling | **Pass** | Cache test reused an existing same-source/same-level variant. Cache count grew only for a new source/level key (3 created in the test session). Clear restores original material reference and does not create a new variant. |
| Cleanup ownership | **Pass** | “释放原型变体” reported `created=3, disposed=3, 原材质 dispose 事件=0`; it restores original references first and disposes only entries owned by the variant cache. |
| Original emissive contribution | **Pass** | Shader adds alarm radiance after existing `totalEmissiveRadiance` has been formed; zero alarm renders the untouched original material. The clear pixel exactly matched the no-alarm baseline. |
| Project Bloom comparison | **Not run** | This isolated entry reuses ACES settings but does not instantiate the project's `EffectComposer` / `UnrealBloomPass`. |
| Production alarm integration | **Not run** | Explicitly out of scope. |

The original shared-material object-uniform path remains a failed control: `Object3D.onBeforeRender` mutates the JS value, but r185 only uploads standard-material `onBeforeCompile` uniforms on `refreshMaterial`. A single stable material can therefore retain the previous GPU value. The finite-cache result differs because each alarm severity uses a material clone with its own shader program/material property state; importantly, time still changes on the same stable variant and was verified from framebuffer pixels.

Build verification: `npm run build` passed. Vite's configured production inputs do not include this temporary HTML entry, so the prototype is run through the dev server.

## Integration Decision

The three required prototype checks pass: single-object continuous pulse, three-object state isolation, and material cache/recovery. The finite-material method is viable for ordinary meshes, subject to a focused production integration and visual review with Bloom enabled.

Minimal production integration should add a small alarm-material-variant owner alongside the visual system. It should cache by original material identity and severity, hold source-to-variant ownership/refcounts, update each live variant's time value every frame, and restore source references before releasing variants. It must support material arrays slot-by-slot and dispose only variants the owner created after no mesh references them. `AlarmVisualSystem` would set the mesh's material slots on alarm/level changes and restore originals on clear or entity/model disposal; `PortRuntime` would provide the per-frame clock and dispose the owner during shutdown. `GpuResourcePool` and `InstanceBatch` do not need changes for this ordinary-Mesh prototype. Those production files were not modified in this validation.
