# Robotics features

BetterCad is for designing robot parts to print. This page records the principles and chosen features from Kev's "CAD Applications, File Formats and Standout Features" reference (7 November 2026), and maps them to epics. File formats are covered separately in [cad-formats.md](cad-formats.md) (epic #152).

## Principles

The test for every new feature: does it help someone design a printable robot part? If not, it belongs elsewhere.

1. **Do one thing well.** Robot parts to print. Simulation, CAM and electronics live in other tools.
2. **Simple on the surface, powerful underneath.** A beginner gets a result in five minutes; advanced features stay out of the way until needed.
3. **Print is the goal.** Every feature should help a part come off the printer right the first time.
4. **Open by default.** Open formats and open source, so people own their designs.
5. **Connect, don't absorb.** Hand off to other tools with good exports (URDF, glTF, STL) rather than rebuilding them.
6. **Browser first.** If a feature can't run well in a browser, it doesn't get built.

## Where BetterCad fits

BetterCad is one tool in the kevsrobots.com suite: Snakie writes MicroPython for robots, Projects 2.0 documents and shares projects, and a physics simulator and an edge AI tool may follow. BetterCad hands URDF to Snakie and simulators, and embeds to Projects 2.0.

The suite is meant to share one parts catalogue (BetterCad uses a part's model and cutout, Snakie its pins and code, Projects 2.0 its description and buy link), one project ID across the three tools, and live embeds that update when a part is edited.

## Chosen features and their epics

| Feature | Epic | Notes |
| --- | --- | --- |
| Joints in an assembly, exported to URDF | #164 | Links and joints are timeline steps; posing is view state |
| Mass, centre of mass and inertia | #164 (#174) | Builds on the print weight estimate (#105); feeds URDF |
| Inverse kinematics | #165 | Drag the tool point; the same joints as URDF |
| Collision detection, including across joint ranges | #165 | Fast mesh test, confirmed by the kernel |
| Printer profiles and named fits (press, sliding, loose) | #166 | Builds on the hole offset (#104); gaps are per side |
| Robot parts catalogue with cutouts | #167 | Servos, motors, boards, sensors, bearings; drawn by us, MIT |
| One-click mounting features | #167 (#189) | Hole patterns, standoffs, servo horn mounts |
| STL as a reference body | #167 (#185) | Shown, never printed or exported |
| Parametric gear generator | #168 | Involute spur gears as editable sketches |
| Drive linkages | #168 (#194) | Ratios between joints; URDF `<mimic>` |
| Render export (glTF) and in-browser path tracing | #169 | Both load lazily to keep the load budget |
| Publish, remix with credit, embeds in Projects 2.0 | #170 | #93's embed route moved under it |

Already built: constrained sketches, the timeline, section view, STL, 3MF and STEP export, print checks, weight, printed hole fits.

## Out of scope

- Physics simulation: export URDF with mass and inertia to MuJoCo or Gazebo instead.
- CAM, electronics and generative design.
- Collaborative live editing, for now: remixing gives most of the benefit for far less work.

## Fits

Typical FDM starting points: press about 0.1 to 0.2 mm, sliding about 0.2 to 0.3 mm, loose about 0.4 mm or more. A printer profile sets the baseline, tuned with a small calibration print; named fits apply it; BetterCad finds mating faces and asks which fit to use. See [fits.md](fits.md).

## Links (#171)

A link is a rigid part of a robot: bodies that move together. Select bodies, then right-click and choose **Make link**, or run Make link from the command palette. A "Link 1" step goes on the timeline.

- The bodies stay separate. Each keeps its own look, and each prints and exports on its own. Group (#66) is different: it joins solids into one.
- A body is in at most one link. Making a new link takes the body out of its old one. Bodies in no link are in the base link.
- Copies (Duplicate, Mirror, Pattern) stay in their original's link. Deleting a body takes it out of its link, and a link with no bodies left disappears from the tree.
- The browser's Robot folder lists Base, then each link with its body count. Click a link to select its bodies, then move them together. **Select link** on a body's menu does the same from the view.
- Until joints (#172) arrive, links are listed flat. Joints will nest each link under the joint it hangs from.
- Files: `.bcad` schema 2 can hold link steps. A schema 1 file opens with every body in Base.

## Joints (#172)

A joint hangs a child link from a parent link, as URDF does. Pick the **Joint** tool (in the Change group), then:

1. Click a body in the link that moves. A body in Base can't move on its own, so make it a link first.
2. Click a body in the link it hangs from, or press Enter (or Base on the bar) to hang it from Base.
3. Click a round edge, a round face or a flat face for the axis. A round edge or face gives its axis through its centre. A flat face gives its normal through its middle. A straight edge gives its own line.

Esc backs out one pick at a time. The joint starts as a hinge from −90° to 90°. The bar names each kind in plain words with URDF's name beside it: Hinge (revolute), Wheel (continuous), Slider (prismatic) and Fixed (fixed). Limits are degrees for a hinge and mm for a slider, and they take expressions from Parameters.

- A link hangs from at most one joint, and loops are refused: "A link can only hang from one joint. Closed loops can't go in URDF."
- The origin and axis are stored in world space when the joint is made, as a hole's frame is, so editing the picked geometry later doesn't move the joint.
- The browser's Joints folder lists each joint. In the Robot folder each link sits under the link it hangs from, with its joint named.
- An arrow along each joint's axis shows in the view. Show or hide joints is in the command palette's View group.
- Still to come: URDF export (#175).

## Posing (#173)

Try the mechanism without adding a step. With the Select tool, Properties shows a slider and a field for each joint that moves: on the model's summary when nothing is selected, and under **Joint** when a body in a jointed link is selected. Hinges and sliders stay between their limits; a wheel turns all the way round (−180° to 180°).

- Forward kinematics runs down the joint tree, so moving a parent carries everything below it, joint arrows included.
- Drag a body in a jointed link to turn it round its hinge or wheel, or slide it along its slider. It snaps to 5° or 1 mm; hold Alt to move freely. Esc during the drag puts it back. A drag that starts on a body in Base, or on empty space, orbits as before.
- Posing moves the drawn bodies only: the kernel doesn't rebuild. Exports use the home pose unless you tick **Export as posed**, which moves the exact solids for STEP and the triangles for STL, 3MF and glTF.
- The pose is saved in the model (`pose`, joint values by joint id), so a shared model opens as it was left. A shared or old version can still be posed; the pose just isn't kept.
- Each move is one undo step. **Home** (or "Move the joints home" in the command palette) puts every joint back where it was made.
- Other tools show the model at home, so picks and moves land on the bodies where they really are.

## Mass (#174)

URDF needs each link's mass, centre of mass and inertia. Once the model has links, the kernel works them out for every body (`mass` in the worker):

- A printed body is a solid shell and a core at the infill percentage, in the material from the Print panel: the full solid at its density, less the core (the body offset inward by the shell, about 2.3 mm) at the part left empty. A body thinner than two shells is solid all through. Where the offset can't be made, the body is weighed evenly at the slicer-style estimate, and Properties says so.
- A body with a datasheet mass (typed in Properties, or a catalogue part's) is spread evenly at that mass. Type 0 to go back to the estimate.
- Holes weigh nothing. A reference body weighs nothing unless it has a datasheet mass, so a motor kept as a reference body still counts once you give it one.
- Link totals combine their bodies with the parallel axis theorem. Bodies in no link make up Base.
- Properties shows the selected body's mass and how it was found, and its link's mass and centre of mass. "Show or hide centres of mass" in the command palette marks each link's centre in the view; the marks follow the pose.
- Inertia is about the centre of mass in g·mm², as tensor entries [ixx, iyy, izz, ixy, ixz, iyz], so the products carry URDF's sign. `measure` now reports each body's inertia at unit density, and the kernel goldens include it.

## URDF export (#175)

Export (Ctrl+E), then URDF, saves the robot as one .zip for Snakie, ROS, MuJoCo and Gazebo:

- `<robot>/<robot>.urdf`, and `<robot>/meshes/<link>.stl` for each link with bodies. The robot's name is the model's, made URDF-safe (letters, digits and underscores).
- Every body that isn't a hole goes in, at home whatever the pose. Reference bodies go in too, since a servo you buy still has a shape and, with a datasheet mass, a weight. Bodies in no link make `base_link`, at the world origin.
- Each link's frame sits at the origin of the joint it hangs from, with axes parallel to the world's. So every joint's `origin` is the child's joint origin less the parent's, its `rpy` is always 0, and its `axis` is the joint's own, as a unit vector. Each link's mesh is moved into its frame.
- Units are URDF's: metres, kilograms, radians and kg·m². Z stays up. Inertia is written to six significant figures, so a small part's few millionths of a kg·m² keep their precision.
- A hinge's limits go out in radians, a slider's in metres, low to high. URDF needs an effort and a velocity for every moving joint: BetterCad writes 10 and 1 for now. A wheel (`continuous`) has no lower or upper.
- A link that hangs from no joint is fixed to `base_link` where it stands, and a joint whose parent link has no bodies hangs from `base_link`, so the file is always one tree.
- "Paths for a ROS package" writes mesh paths as `package://<robot>/meshes/…` instead of `meshes/…`, so the folder in the .zip can go straight into a ROS workspace's `src/`.
- Collision uses the same mesh as the visual. The colour of the link's first coloured body becomes its material.
- The .zip needs at least one joint; without one, the dialog says "Add a joint first to export a robot."

## Drive links (#194)

A drive link makes one joint drive another, so turning one turns the other. Open it from the command palette (Drive link) once the model has two joints that move. Edit it from its step on the timeline.

- Through gears, the driven joint turns the other way by the tooth ratio: a 12-tooth gear turns a 36-tooth one −1/3. Through a belt, it turns the same way. Through a rack, a turn of the gear slides the rack one pitch circle (π × module × teeth: 62.83 mm for module 1 and 20 teeth). The ratio comes from the teeth of the generated gears or pulleys on the two joints' links, preferring a pair that mesh or share a belt. If the joints' axes point opposite ways, the direction flips to match.
- Custom takes the ratio you type: unitless between two hinges, mm a degree from a hinge to a slider. The typed ratio is also used when the links don't both have the gears. "Turn the other way" flips any of them.
- The pose keeps only the driving joint's value. Moving the driven joint, with its slider, its field or a drag in the view, moves the driver to match. Limits on either side stop both. A wheel goes the short way round, so what it drives doesn't jump at 180°. Drives can chain, but a joint can be driven only once, and a loop is refused.
- Play, beside a joint that drives others in Properties, turns it out to each limit and home again over 4 seconds (a wheel turns once). It poses live only; Esc or Stop puts the pose back.
- URDF export writes each driven joint with `<mimic joint multiplier offset>`, its multiplier in radians and metres.

## Inverse kinematics (#176)

Set tool point (command palette) and click a point on a link that hangs on a joint: the gripper's tip, say. A diamond marks it. Then drag any body in that link with the Select tool and the joints between it and Base move so the tool point follows the pointer, within their limits.

- One tool point per chain: setting one on a link replaces any above or below it on the joint tree. Tool points are saved in the file (`tools` in the document, beside `pose`), and Remove the tool points takes them all off.
- The solver is damped least squares over the chain's hinges, wheels and sliders, in `web/src/state/ik.ts` (pure TypeScript, no DOM or kernel). Position only. On each move it aims at the point on the pointer's ray nearest the tool point, so the arm settles where it comes closest to the ray.
- Out of reach, the arm stretches as near as it can and the status says "Out of reach by 12 mm".
- With a tool point set, each joint in Properties has Lock, which keeps it still when you drag the arm. A joint driven by another (#194) follows its driver and isn't solved itself.
- Esc during a drag puts the arm back. Each drag is one undo step, "Move the arm".
- The move gizmo sits on the tool point (of the selected link, or the only one). Drag an arrow to move the tool point along that axis only, a square to keep it in that plane, or the centre to move it freely. The arm follows as above.

## Clash check (#178)

Check for clashes (command palette, or Check clashes under Properties with nothing selected) finds the bodies that overlap at the saved pose. It runs again after each change while it's on.

- Each overlapping pair is listed with its volume, such as "Upper arm and Base overlap by 0.8 cm³". Both bodies are tinted, the overlap is outlined, and Show frames it.
- Pairs that only touch, with no volume between them, are listed under Touching, because printed parts that touch fuse or bind.
- Bodies in the same link are skipped, since they move together; tick Bodies in the same link to include them. Reference bodies are left out unless Reference bodies is ticked. Holes never clash.
- The work runs in the kernel worker: bounding boxes first, then the exact common solid (`BRepAlgoAPI_Common`) of each pair whose boxes meet. A pair with none is touching when its gap is under 1 µm. Progress shows while it runs, and Esc or Stop ends it.
- At picks the pose to check: the one now, Home, or a named pose (#177).
- Not done yet: a triangle pass on the display meshes before the exact check.

## Named poses (#177)

Save pose (command palette, or right-click Poses in the browser) keeps every joint's value under a name, "Pose 1" until you type another. Poses sit under Joints in the browser, with Home always first.

- Click a pose to go to it. The joints move there over 300 ms, or at once with reduced motion. Each go is one undo step, "Go to Reach". The pose the joints are in now is marked Now.
- Right-click a pose to update it to the joints now, rename it (or press F2) or delete it.
- Poses are saved in the `.bcad` file (`poses`, beside `pose`). A pose whose joint was deleted drops that joint, and the status says how many were left out. Values are kept to each joint's limits as they are now.
- The clash check (At) and Export as posed (Pose) can use a named pose. A shared, view-only model lists its poses and can go to them, but can't change them.
