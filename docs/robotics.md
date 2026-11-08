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
