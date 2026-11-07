/**
 * What the Help menu links to and what About lists (#110). The libraries mirror THIRD_PARTY_LICENSES.md; a test keeps
 * the two in step.
 */

/** The "Learn BetterCad" course on kevsrobots.com. A placeholder until the course is published. */
export const COURSE_URL = "https://www.kevsrobots.com/learn/bettercad/";
export const SOURCE_URL = "https://github.com/kevinmcaleer/BetterCad";
export const LICENCES_URL = `${SOURCE_URL}/blob/main/THIRD_PARTY_LICENSES.md`;

export interface Library {
  name: string;
  use: string;
  licence: string;
  url: string;
}

export const LIBRARIES: Library[] = [
  {
    name: "OpenCascade Technology",
    use: "The modelling kernel",
    licence: "LGPL 2.1 with the OCCT exception",
    url: "https://dev.opencascade.org/resources/licensing",
  },
  { name: "planegcs", use: "Sketch constraints", licence: "LGPL 2.0 or later", url: "https://github.com/Salusoft89/planegcs" },
  { name: "three.js", use: "The 3D view", licence: "MIT", url: "https://github.com/mrdoob/three.js" },
  { name: "React", use: "The interface", licence: "MIT", url: "https://github.com/facebook/react" },
  { name: "FastAPI", use: "The server", licence: "MIT", url: "https://github.com/fastapi/fastapi" },
];
