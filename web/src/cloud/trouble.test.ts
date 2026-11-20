import { ApiError, OFFLINE } from "./api";
import { trouble } from "./trouble";

describe("trouble", () => {
  it("tells offline, no server and a run-out sign-in apart", () => {
    expect(trouble(new ApiError(OFFLINE, 0, undefined, { why: "network" }), false)?.kind).toBe("offline");
    expect(trouble(new ApiError(OFFLINE, 0, undefined, { why: "network" }), true)).toEqual({
      kind: "unreachable",
      text: "BetterCad’s server can’t be reached just now. Your connection looks fine.",
    });
    expect(trouble(new ApiError(OFFLINE, 0, undefined, { why: "no-server", http: 504 }), true)?.text).toContain("(error 504)");
    expect(trouble(new ApiError("Sign in to do that.", 401), true)?.kind).toBe("signin");
  });

  it("passes on the server's own words for a 5xx, and leaves ordinary errors alone", () => {
    const t = trouble(new ApiError("kevsrobots.com sign-in can't be reached just now. Try again in a minute.", 503), true);
    expect(t).toEqual({ kind: "unreachable", text: "kevsrobots.com sign-in can't be reached just now. Try again in a minute." });
    expect(trouble(new ApiError("That didn't work.", 400), true)).toBeNull();
    expect(trouble(new Error("boom"), true)).toBeNull();
  });
});
