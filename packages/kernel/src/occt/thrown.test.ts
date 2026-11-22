import { beforeAll, describe, expect, it } from "vitest";
import { loadOCCT, type OC } from "./oc";
import { describeThrown, unexpected } from "../errors";

let oc: OC;
beforeAll(async () => {
  oc = await loadOCCT();
}, 60_000);

const thrown = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected a throw");
};

describe("errors OCCT throws that aren't KernelErrors", () => {
  it("say OCCT's own type and message rather than [object WebAssembly.Exception]", () => {
    const e = thrown(() => new oc.gp_Dir(0, 0, 0));
    const read = (x: unknown) => oc.getExceptionMessage(x as Parameters<OC["getExceptionMessage"]>[0]);
    expect(describeThrown(e, read)).toBe("Standard_ConstructionError: gp_Dir() - input vector has zero norm");
    expect(unexpected(e, read)).toEqual({
      code: "failed",
      message: "Something went wrong in the geometry engine (Standard_ConstructionError: gp_Dir() - input vector has zero norm).",
      detail: "Standard_ConstructionError: gp_Dir() - input vector has zero norm",
    });
  });

  it("tell running out of memory apart, so you know to reload", () => {
    expect(unexpected(new RangeError("WebAssembly.Memory.grow(): Maximum memory size exceeded")).code).toBe("kernel-crashed");
    const oom = unexpected(new Error("Aborted(OOM)"));
    expect(oom.code).toBe("kernel-crashed");
    expect(oom.message).toBe("The geometry engine ran out of memory. Save your model, reload the page and try again.");
    expect(unexpected(new TypeError("x is undefined")).message).toBe("Something went wrong in the geometry engine (TypeError: x is undefined).");
  });
});
