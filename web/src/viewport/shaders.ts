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
  uniform float dof;
  uniform float focus;
  uniform float range;
  uniform vec3 bg;
  varying vec3 vWorld;
  varying vec3 vNormal;
  // u is c / s, so its screen-space width is fw / s: one fwidth serves every scale (and the axes).
  float lines(vec2 u, vec2 fu) {
    vec2 g = abs(fract(u - 0.5) - 0.5) / fu;
    return 1.0 - min(min(g.x, g.y), 1.0);
  }
  void main() {
    vec3 n = abs(vNormal);
    vec2 c = n.z > 0.5 ? vWorld.xy : (n.x > 0.5 ? vWorld.yz : vWorld.xz);
    float f = 1.0 - smoothstep(fade * 0.35, fade, distance(eye, vWorld));
    if (f <= 0.0 && dof < 0.5) discard;
    vec2 fw = fwidth(c);
    // Lines closer together than a few pixels fade out, so the far grid does not shimmer.
    vec2 dm = fw / step;
    float dmax = max(dm.x, dm.y);
    float minor = lines(c / step, dm) * (1.0 - smoothstep(0.12, 0.35, dmax));
    float major = lines(c / (step * 10.0), dm / 10.0) * (1.0 - smoothstep(0.12, 0.35, dmax / 10.0));
    vec3 colour = mix(minorColour, majorColour, major);
    float a = max(minor * minorAlpha, major);
    if (room < 0.5) {
      // The floor's c is its world x and y.
      vec2 w = fw * 1.5;
      float onX = 1.0 - smoothstep(0.0, w.y, abs(vWorld.y));
      float onY = 1.0 - smoothstep(0.0, w.x, abs(vWorld.x));
      if (onX > 0.01) { colour = xColour; a = max(a, onX); }
      if (onY > 0.01) { colour = yColour; a = max(a, onY); }
    }
    a *= f;
    if (dof > 0.5) {
      // Depth of field: opaque over the background, with how far out of focus this point is in alpha.
      float d = distance(eye, vWorld);
      float coc = smoothstep(0.0, focus, abs(d - focus) - range);
      gl_FragColor = vec4(mix(bg, colour, a), coc);
      return;
    }
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
      dof: { value: 0 },
      focus: { value: 100 },
      range: { value: 100 },
      bg: { value: new Color() },
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

// ------------------------------------------------------------ depth of field

/**
 * One direction of the Holodeck's blur. Alpha holds each pixel's circle of confusion (0 sharp, 1 fully blurred);
 * the taps spread with it, and taps sharper than the pixel count for less, so the in-focus floor does not smear
 * into the blurred walls.
 */
const BLUR_FRAG = `
  uniform sampler2D tColour;
  uniform vec2 spread;
  varying vec2 vUv;
  void main() {
    vec4 here = texture2D(tColour, vUv);
    float coc = here.a;
    vec3 sum = here.rgb;
    float total = 1.0;
    for (int i = 1; i <= 8; i++) {
      float t = float(i) / 8.0;
      float w = exp(-3.0 * t * t);
      vec2 off = spread * t * coc;
      vec4 a = texture2D(tColour, vUv + off);
      vec4 b = texture2D(tColour, vUv - off);
      float wa = w * clamp(a.a * 4.0, 0.0, 1.0);
      float wb = w * clamp(b.a * 4.0, 0.0, 1.0);
      sum += a.rgb * wa + b.rgb * wb;
      total += wa + wb;
    }
    gl_FragColor = vec4(sum / total, coc);
  }`;

export function blurMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { tColour: { value: null }, spread: { value: new Vector2() } },
    vertexShader: QUAD_VERT,
    fragmentShader: BLUR_FRAG,
    depthTest: false,
    depthWrite: false,
  });
}

/** Lays the room down as the background: sharp where it is in focus, the blurred copy where it is not. */
const DOF_FRAG = `
  uniform sampler2D tSharp;
  uniform sampler2D tBlur;
  varying vec2 vUv;
  void main() {
    vec4 sharp = texture2D(tSharp, vUv);
    vec3 blur = texture2D(tBlur, vUv).rgb;
    gl_FragColor = vec4(mix(sharp.rgb, blur, smoothstep(0.0, 0.25, sharp.a)), 1.0);
  }`;

export function dofMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { tSharp: { value: null }, tBlur: { value: null } },
    vertexShader: QUAD_VERT,
    fragmentShader: DOF_FRAG,
    depthTest: false,
    depthWrite: false,
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
