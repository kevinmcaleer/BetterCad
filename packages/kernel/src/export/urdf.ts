/**
 * URDF export (#175): the robot as links and joints for Snakie, ROS, MuJoCo and Gazebo. Pure: the kernel worker hands
 * in each body's triangles and mass, and gets back the .urdf text and one mesh per link.
 *
 * Frames: every link's frame sits at the origin of the joint it hangs from (Base at the world origin), with axes
 * parallel to the world's, as the model stands at home. So each joint's origin is the difference of two points and its
 * rpy is always 0, and the axis is the joint's own. Units go out as URDF has them: metres, kilograms, radians and
 * kg·m². Z stays up.
 */
import type { V3 } from "../joints";
import type { JointFeature } from "../document";
import { combine, type MassProps } from "../mass";

/** What the planner needs of a body. */
export interface UrdfBody {
  id: string;
  name: string;
  /** The link step it belongs to; none for Base. */
  link?: string;
  colour?: string;
  /** Triangles in the world, mm. */
  triangles: Float32Array;
  /** Its mass properties, when it has mass. */
  mass?: MassProps;
}

export interface UrdfOptions {
  /** The robot's name: the model's. */
  name: string;
  /** Mesh paths as `package://<robot>/meshes/…` for ROS, instead of relative `meshes/…`. */
  rosPackage?: boolean;
  /** Defaults for each moving joint's effort (N·m or N) and velocity (rad/s or m/s): URDF requires them. */
  effort?: number;
  velocity?: number;
}

export interface UrdfLinkOut {
  name: string;
  /** Path to its mesh inside the .zip, or none for a link with no bodies. */
  mesh?: string;
  /** Triangles in the link's frame, metres. */
  triangles: Float32Array;
}

export interface UrdfResult {
  urdf: string;
  links: UrdfLinkOut[];
  robot: string;
}

/** A name URDF and ROS accept: letters, digits and underscores, not starting with a digit, unique among `taken`. */
export function urdfName(raw: string, taken: Set<string>): string {
  let base =
    raw
      .trim()
      .replace(/[^A-Za-z0-9_]+/g, "_")
      .replace(/^_+|_+$/g, "") || "part";
  if (/^[0-9]/.test(base)) base = `_${base}`;
  let name = base;
  for (let i = 2; taken.has(name); i++) name = `${base}_${i}`;
  taken.add(name);
  return name;
}

const URDF_TYPE: Record<JointFeature["kind"], string> = { revolute: "revolute", continuous: "continuous", prismatic: "prismatic", fixed: "fixed" };
const n = (v: number) => {
  const r = Math.round(v * 1e9) / 1e9;
  return String(Object.is(r, -0) ? 0 : r);
};
/** Six significant figures, for inertia: a small part's is a few millionths of a kg·m², too small for fixed places. */
const sig = (v: number) => (v === 0 ? "0" : String(Number(v.toPrecision(6))));
const v3 = (v: V3) => v.map(n).join(" ");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const DEG = Math.PI / 180;

/** "#rrggbb" to URDF's "r g b a" in 0…1 (sRGB, as viewers expect). */
function rgba(hex: string | undefined): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return "0.8 0.8 0.8 1";
  return [m[1], m[2], m[3]].map((h) => n(Math.round((parseInt(h!, 16) / 255) * 1000) / 1000)).join(" ") + " 1";
}

/**
 * Plans and writes the robot. `links` are the model's link steps in timeline order; `joints` the joints that built.
 * Links that hang from no joint are fixed to Base where they stand, so the URDF is always one tree.
 */
export function buildUrdf(bodies: UrdfBody[], links: { id: string; name: string }[], joints: JointFeature[], o: UrdfOptions): UrdfResult {
  if (!joints.length) throw new Error("Add a joint first to export a robot.");
  const taken = new Set<string>();
  const robot = urdfName(o.name, new Set());
  const BASE = "";
  const nameOf = new Map<string, string>([[BASE, urdfName("base_link", taken)]]);
  for (const l of links) nameOf.set(l.id, urdfName(l.name, taken));
  const jointOf = new Map(joints.map((j) => [j.child, j]));
  // Each link's frame origin in the world, mm.
  const originOf = (id: string): V3 => (id === BASE ? [0, 0, 0] : (jointOf.get(id)?.origin ?? [0, 0, 0]));
  const effort = o.effort ?? 10;
  const velocity = o.velocity ?? 1;
  const dir = o.rosPackage ? `package://${robot}/meshes` : "meshes";

  const out: string[] = [`<?xml version="1.0"?>`, `<robot name="${esc(robot)}">`];
  const meshes: UrdfLinkOut[] = [];
  const colours = new Map<string, string>();
  for (const id of [BASE, ...links.map((l) => l.id)]) {
    const name = nameOf.get(id)!;
    const own = bodies.filter((b) => (b.link ?? BASE) === id);
    const at = originOf(id);
    // The link's triangles, moved into its frame and into metres.
    const total = own.reduce((a, b) => a + b.triangles.length, 0);
    const tris = new Float32Array(total);
    let k = 0;
    for (const b of own) for (let i = 0; i < b.triangles.length; i++, k++) tris[k] = (b.triangles[i]! - at[i % 3]!) / 1000;
    const mesh = total ? `${name}.stl` : undefined;
    if (mesh) meshes.push({ name, mesh: `meshes/${mesh}`, triangles: tris });
    out.push(`  <link name="${name}">`);
    const masses = own.flatMap((b) => (b.mass && b.mass.mass > 0 ? [b.mass] : []));
    if (masses.length) {
      const m = combine(masses);
      const [ixx, iyy, izz, ixy, ixz, iyz] = m.inertia.map((x) => x * 1e-9);
      out.push(
        `    <inertial>`,
        `      <origin xyz="${v3([(m.com[0] - at[0]) / 1000, (m.com[1] - at[1]) / 1000, (m.com[2] - at[2]) / 1000])}" rpy="0 0 0"/>`,
        `      <mass value="${sig(m.mass / 1000)}"/>`,
        `      <inertia ixx="${sig(ixx!)}" ixy="${sig(ixy!)}" ixz="${sig(ixz!)}" iyy="${sig(iyy!)}" iyz="${sig(iyz!)}" izz="${sig(izz!)}"/>`,
        `    </inertial>`,
      );
    }
    if (mesh) {
      const colour = own.find((b) => b.colour)?.colour;
      const material = `${name}_material`;
      colours.set(material, rgba(colour));
      const geometry = `<geometry><mesh filename="${esc(`${dir}/${mesh}`)}"/></geometry>`;
      out.push(
        `    <visual>`,
        `      <origin xyz="0 0 0" rpy="0 0 0"/>`,
        `      ${geometry}`,
        `      <material name="${material}"><color rgba="${colours.get(material)}"/></material>`,
        `    </visual>`,
        `    <collision>`,
        `      <origin xyz="0 0 0" rpy="0 0 0"/>`,
        `      ${geometry}`,
        `    </collision>`,
      );
    }
    out.push(`  </link>`);
  }

  for (const l of links) {
    const j = jointOf.get(l.id);
    // A parent link with no bodies left isn't written, so its children hang from Base.
    const parent = j?.parent && nameOf.has(j.parent) ? j.parent : BASE;
    const child = l.id;
    const from = originOf(parent);
    const to = originOf(child);
    const name = urdfName(j ? j.name : `${l.name} fixed`, taken);
    const kind = j ? URDF_TYPE[j.kind] : "fixed";
    out.push(
      `  <joint name="${name}" type="${kind}">`,
      `    <parent link="${nameOf.get(parent)!}"/>`,
      `    <child link="${nameOf.get(child)!}"/>`,
      `    <origin xyz="${v3([(to[0] - from[0]) / 1000, (to[1] - from[1]) / 1000, (to[2] - from[2]) / 1000])}" rpy="0 0 0"/>`,
    );
    if (j && j.kind !== "fixed") {
      const len = Math.hypot(...j.axis) || 1;
      out.push(`    <axis xyz="${v3([j.axis[0] / len, j.axis[1] / len, j.axis[2] / len])}"/>`);
      if (j.kind === "revolute")
        out.push(
          `    <limit lower="${n(Math.min(j.lower, j.upper) * DEG)}" upper="${n(Math.max(j.lower, j.upper) * DEG)}" effort="${n(effort)}" velocity="${n(velocity)}"/>`,
        );
      else if (j.kind === "prismatic")
        out.push(
          `    <limit lower="${n(Math.min(j.lower, j.upper) / 1000)}" upper="${n(Math.max(j.lower, j.upper) / 1000)}" effort="${n(effort)}" velocity="${n(velocity)}"/>`,
        );
      else out.push(`    <limit effort="${n(effort)}" velocity="${n(velocity)}"/>`);
    }
    out.push(`  </joint>`);
  }
  out.push(`</robot>`, "");
  return { urdf: out.join("\n"), links: meshes, robot };
}
