// Shared glow-particle shader, originally from the run-048 helix waveform.
// Round additive-blended points with a squared-falloff glow; per-particle
// size, alpha, and colour ride in as attributes. Used by BrainCore's
// WaveformPulses/BackgroundMist and RelayFlow's beam pulses / history arcs.

export const pulseVertex = `
  uniform float uTime;
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (180.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
  }
`;

export const pulseFragment = `
  varying float vAlpha;
  varying vec3 vColor;

  void main() {
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float glow = 1.0 - smoothstep(0.0, 0.5, r);
    glow = pow(glow, 2.0);
    gl_FragColor = vec4(vColor, glow * vAlpha);
  }
`;
