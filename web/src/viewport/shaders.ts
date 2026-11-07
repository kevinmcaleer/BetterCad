import { BackSide, Color, DoubleSide, ShaderMaterial, Vector2, Vector3 } from "three";

/**
 * The viewport's own shaders. Colours are uniforms filled from the theme's tokens (see colours.ts), never literals.
 */

// ------------------------------------------------------------ grid and room

const GRID_VERT = `
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

/**
 * Minor and major lines, anti-aliased with fwidth, fading with distance from the camera. On the floor the X and Y
 * axes are drawn in their colours. `room` picks the plane's axes from its normal, so one shader draws the
 * Holodeck's floor, walls and ceiling.
 */
const GRID_FRAG = `
  uniform vec3 minorColour;
  uniform vec3 majorColour;
  uniform vec3 xColour;
  uniform vec3 yColour;
  uniform float step;
  uniform float fade;
  uniform float minorAlpha;
  uniform float room;
  uniform vec3 eye;
  varying vec3 vWorld;
  varying vec3 vNormal;
  float lines(vec2 c) {
    vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    vec3 n = abs(vNormal);
    vec2 c = n.z > 0.5 ? vWorld.xy : (n.x > 0.5 ? vWorld.yz : vWorld.xz);
    // Lines closer together than a few pixels fade out, so the far grid does not shimmer.
    vec2 dm = fwidth(c / step);
    float minor = lines(c / step) * (1.0 - smoothstep(0.12, 0.35, max(dm.x, dm.y)));
    float major = lines(c / (step * 10.0)) * (1.0 - smoothstep(0.12, 0.35, max(dm.x, dm.y) / 10.0));
    float f = 1.0 - smoothstep(fade * 0.35, fade, distance(eye, vWorld));
    vec3 colour = mix(minorColour, majorColour, major);
    float a = max(minor * minorAlpha, major);
    if (room < 0.5) {
      vec2 w = fwidth(vWorld.xy) * 1.5;
      float onX = 1.0 - smoothstep(0.0, w.y, abs(vWorld.y));
      float onY = 1.0 - smoothstep(0.0, w.x, abs(vWorld.x));
      if (onX > 0.01) { colour = xColour; a = max(a, onX); }
      if (onY > 0.01) { colour = yColour; a = max(a, onY); }
    }
    a *= f;
    if (a < 0.01) discard;
    gl_FragColor = vec4(colour, a);
  }`;

export function gridMaterial(room = false): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      minorColour: { value: new Color() },
      majorColour: { value: new Color() },
      xColour: { value: new Color() },
      yColour: { value: new Color() },
      step: { value: 1 },
      fade: { value: 1000 },
      minorAlpha: { value: 0.7 },
      room: { value: room ? 1 : 0 },
      eye: { value: new Vector3() },
    },
    vertexShader: GRID_VERT,
    fragmentShader: GRID_FRAG,
    transparent: true,
    depthWrite: false,
    side: room ? BackSide : DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 4,
  });
}

// ------------------------------------------------------------ picking

const PICK_VERT = `
  attribute float element;
  uniform float body;
  uniform float pointSize;
  varying vec4 vId;
  void main() {
    float b = body + 1.0;
    vId = vec4(floor(b / 256.0), mod(b, 256.0), floor(element / 256.0), mod(element, 256.0)) / 255.0;
    gl_PointSize = pointSize;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;
const PICK_FRAG = `
  varying vec4 vId;
  void main() { gl_FragColor = vId; }`;

/** Writes body and element IDs (see ids.ts). Faces push back so edges and points on them win. */
export function pickMaterial(kind: "face" | "line" | "point"): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { body: { value: 0 }, pointSize: { value: 14 } },
    vertexShader: PICK_VERT,
    fragmentShader: PICK_FRAG,
    side: DoubleSide,
    polygonOffset: kind === "face",
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 2,
  });
}

// ------------------------------------------------------------ line art

export const QUAD_VERT = "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

/**
 * Line art's outline pass (after Layers' render.ts): wherever a pixel within `width` belongs to another body or to
 * nothing, draw the line colour. That gives every body its bold outline, even where it overlaps another.
 */
const OUTLINE_FRAG = `
  uniform sampler2D tId;
  uniform vec2 px;
  uniform float width;
  uniform vec3 colour;
  varying vec2 vUv;
  void main() {
    vec4 here = texture2D(tId, vUv);
    for (int r = 1; r <= 8; r++) {
      float fr = float(r);
      if (fr > width) break;
      for (int k = 0; k < 12; k++) {
        float a = float(k) * 0.5235988;
        vec4 there = texture2D(tId, vUv + vec2(cos(a), sin(a)) * fr * px);
        if (distance(there, here) > 0.001 && (here.a > 0.5 || there.a > 0.5)) {
          gl_FragColor = vec4(colour, 1.0);
          return;
        }
      }
    }
    discard;
  }`;

export function outlineMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { tId: { value: null }, px: { value: new Vector2(1, 1) }, width: { value: 2 }, colour: { value: new Color() } },
    vertexShader: QUAD_VERT,
    fragmentShader: OUTLINE_FRAG,
    depthTest: false,
    depthWrite: false,
    transparent: true,
  });
}

// ------------------------------------------------------------ section caps

const CAP_VERT = "void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
/** A cut face: the part's fill, hatched at 45° across the screen like a drawing. */
const CAP_FRAG = `
  uniform vec3 fill;
  uniform vec3 line;
  uniform float spacing;
  void main() {
    float d = mod(dot(gl_FragCoord.xy, vec2(0.7071, 0.7071)), spacing);
    float off = min(d, spacing - d);
    float a = clamp(1.0 - off, 0.0, 1.0);
    gl_FragColor = vec4(mix(fill, line, a), 1.0);
  }`;

export function capMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { fill: { value: new Color() }, line: { value: new Color() }, spacing: { value: 8 } },
    vertexShader: CAP_VERT,
    fragmentShader: CAP_FRAG,
    side: DoubleSide,
  });
}
