import { solverStatus } from "./index";

describe("sketch", () => {
  it("reports that the solver is not loaded yet", () => {
    expect(solverStatus()).toEqual({ ready: false, engine: "planegcs" });
  });
});
