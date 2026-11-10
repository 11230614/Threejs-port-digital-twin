// ShaderMaterial's default GLSL ES 1.00 interface; Three supplies precision/matrices.
export const agvRadarVertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const agvRadarFragmentShader = /* glsl */ `
uniform float uScanPhase;
uniform float uDirection;
uniform vec3 uColor;
varying vec2 vUv;
const float TAU = 6.28318530718;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  // Reject the square corners before angular/colour calculations.
  if (r >= 1.0) discard;
  float aa = max(fwidth(r), 0.002);
  float edge = 1.0 - smoothstep(1.0 - aa * 2.0, 1.0, r);
  float angle = atan(p.y, p.x);
  // Positive distance behind the head, continuous across 0/TAU.
  float behind = mod(uDirection * (uScanPhase - angle) + TAU, TAU);
  float tailWidth = 1.65;
  float tail = smoothstep(0.0, 0.06, behind) * pow(max(0.0, 1.0 - behind / tailWidth), 2.0);
  float periodicDistance = abs(atan(sin(angle - uScanPhase), cos(angle - uScanPhase)));
  float head = 1.0 - smoothstep(0.012, 0.055, periodicDistance);
  float ringDistance = abs(fract(r * 4.0 + 0.5) - 0.5) / 4.0;
  float rings = 1.0 - smoothstep(0.003, 0.003 + aa, ringDistance);
  float rim = 1.0 - smoothstep(0.004, 0.004 + aa, abs(r - 0.97));
  float centreFade = smoothstep(0.025, 0.12, r);
  float intensity = (tail * 0.65 + head * 0.35) * centreFade;
  float alpha = edge * (0.025 + rings * 0.18 + rim * 0.24 + intensity * 0.60);
  gl_FragColor = vec4(uColor * (0.8 + intensity * 0.9), min(alpha, 0.70));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;
