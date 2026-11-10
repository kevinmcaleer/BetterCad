import { describe, expect, it } from "vitest";
import { PROJECTS_API, editorUrl, kevsrobots, titleProblem } from "./kevsrobots";

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("kevsrobots projects client", () => {
  it("lists, makes and sends with the shared sign-in cookie", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const kr = kevsrobots(async (url, init) => {
      seen.push({ url: String(url), init });
      if (String(url).endsWith("/imports")) return res(201, { id: 9, project_id: 3, title: "Bracket", steps: 2, pictures: 3, files: 2, is_update: false });
      if (init?.method === "POST") return res(201, { id: 3, title: "Bracket build", status: "draft", cover_image: null });
      return res(200, [{ id: 3, title: "Bracket build", status: "draft", cover_image: null }]);
    });
    expect((await kr.projects())[0]!.title).toBe("Bracket build");
    expect(seen[0]!.url).toBe(`${PROJECTS_API}/api/projects/my/list`);
    expect(seen[0]!.init?.credentials).toBe("include");

    await kr.create("  Bracket build ");
    expect(JSON.parse(seen[1]!.init!.body as string)).toEqual({ title: "Bracket build", status: "draft", tags: ["bettercad", "3d-printing"] });

    const sent = await kr.send(3, "Bracket build steps.zip", new Uint8Array([1, 2]), "https://bettercad.kevsrobots.com/#/edit/m1");
    expect(sent.id).toBe(9);
    expect(seen[2]!.url).toBe(`${PROJECTS_API}/api/projects/3/imports`);
    const form = seen[2]!.init!.body as FormData;
    expect((form.get("file") as File).name).toBe("Bracket build steps.zip");
    expect(form.get("source")).toBe("bettercad");
    expect(form.get("model_url")).toBe("https://bettercad.kevsrobots.com/#/edit/m1");
  });

  it("says what to do when kevsrobots says no", async () => {
    await expect(kevsrobots(async () => res(401, { detail: "Not authenticated" })).projects()).rejects.toThrow("Sign in with your kevsrobots account first.");
    await expect(kevsrobots(async () => res(403, { detail: "Accept the terms first" })).projects()).rejects.toThrow(/Accept the kevsrobots terms/);
    await expect(kevsrobots(async () => res(400, { detail: "A picture is too big" })).projects()).rejects.toThrow("A picture is too big");
    await expect(kevsrobots(async () => res(404, { detail: "Not Found" })).send(3, "a.zip", new Uint8Array([1]))).rejects.toThrow(/server needs updating/);
    await expect(
      kevsrobots(async () => {
        throw new TypeError("network");
      }).projects(),
    ).rejects.toThrow(/can't be reached/);
  });

  it("checks project names and links to the project's editor", () => {
    expect(titleProblem("Arm")).toBe("Use at least 5 characters.");
    expect(titleProblem("Robot arm")).toBeNull();
    expect(editorUrl(3)).toBe("https://www.kevsrobots.com/projects/editor.html?id=3");
  });
});
