import * as THREE from "three";
import { AlarmSeverity, type AlarmSeverityValue } from "../domain/AlarmCatalog";

export const ALARM_COLORS: Record<AlarmSeverityValue, THREE.Color> = {
  INFO: new THREE.Color(0x68d7ff), WARNING: new THREE.Color(0xffd45c),
  SEVERE: new THREE.Color(0xff7a2f), URGENT: new THREE.Color(0xff3333),
};
interface ColoredMaterial extends THREE.Material { color?: THREE.Color; emissive?: THREE.Color; emissiveIntensity?: number }
export interface AlarmVariant { original: THREE.Material; material: ColoredMaterial; severity: AlarmSeverityValue; refs: number; shader: boolean }

/** Owns material clones only. Textures, geometry and source materials remain borrowed. */
export class AlarmMaterialVariants {
  private readonly cache = new Map<THREE.Material, Map<AlarmSeverityValue, AlarmVariant>>();
  private readonly time = { value: 0 };
  private readonly white = new THREE.Color(0xffffff);
  created = 0;
  disposed = 0;

  acquire(original: THREE.Material, severity: AlarmSeverityValue): AlarmVariant {
    let levels = this.cache.get(original);
    if (!levels) { levels = new Map(); this.cache.set(original, levels); }
    let entry = levels.get(severity);
    if (!entry) {
      const material = original.clone() as ColoredMaterial;
      // Custom compile hooks can alter/remove the chunks we patch; preserve the old
      // CPU behavior for these materials rather than guessing their shader layout.
      const shader = original instanceof THREE.MeshStandardMaterial
        && original.onBeforeCompile === THREE.Material.prototype.onBeforeCompile;
      entry = { original, material, severity, refs: 0, shader };
      if (shader) {
        const previous = original.onBeforeCompile;
        const key = original.customProgramCacheKey();
        const color = ALARM_COLORS[severity];
        const pulsing = severity === AlarmSeverity.SEVERE || severity === AlarmSeverity.URGENT;
        material.onBeforeCompile = (program, renderer) => {
          previous.call(material, program, renderer);
          program.uniforms.uAlarmTime = this.time;
          program.fragmentShader = program.fragmentShader.replace("void main() {", "uniform float uAlarmTime;\nvoid main() {");
          program.fragmentShader = program.fragmentShader.replace("#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>\nfloat alarmPulse = ${pulsing ? "0.45 + abs(sin(uAlarmTime * 7.0)) * 0.55" : "0.72"};\ntotalEmissiveRadiance += vec3(${color.r}, ${color.g}, ${color.b}) * alarmPulse * ${severity === AlarmSeverity.URGENT ? "1.6" : "0.8"};`);
        };
        material.customProgramCacheKey = () => `${key}|port-alarm-emissive-v1-${severity}`;
      } else {
        material.onBeforeCompile = original.onBeforeCompile;
        material.customProgramCacheKey = () => original.customProgramCacheKey();
      }
      levels.set(severity, entry);
      this.created++;
    }
    entry.refs++;
    return entry;
  }

  release(entry: AlarmVariant): void {
    if (--entry.refs > 0) return;
    entry.material.dispose();
    this.disposed++;
    const levels = this.cache.get(entry.original);
    levels?.delete(entry.severity);
    if (!levels?.size) this.cache.delete(entry.original);
  }

  beforeRender(elapsedTime: number): void { this.time.value = elapsedTime; }

  /** Compatibility materials keep the former 100ms CPU color/emissive/opacity path. */
  updateFallback(elapsedTime: number): void {
    for (const levels of this.cache.values()) for (const entry of levels.values()) {
      if (entry.shader) continue;
      const { material, severity, original } = entry;
      const pulse = severity === AlarmSeverity.SEVERE || severity === AlarmSeverity.URGENT
        ? 0.45 + Math.abs(Math.sin(elapsedTime * 7)) * 0.55 : 0.72;
      material.color?.copy(ALARM_COLORS[severity]).lerp(this.white, 1 - pulse);
      material.emissive?.copy(ALARM_COLORS[severity]);
      if (material.emissive) material.emissiveIntensity = (severity === AlarmSeverity.URGENT ? 1.6 : 0.8) * pulse;
      if (material.transparent) material.opacity = Math.max(original.opacity, 0.22 + pulse * 0.18);
    }
  }

  snapshot() {
    const entries = [...this.cache.values()].flatMap((levels) => [...levels.values()]);
    return { created: this.created, disposed: this.disposed, live: entries.length,
      shaderVariants: entries.filter((entry) => entry.shader).length,
      fallbackVariants: entries.filter((entry) => !entry.shader).length,
      references: entries.reduce((sum, entry) => sum + entry.refs, 0), time: this.time.value };
  }
}
