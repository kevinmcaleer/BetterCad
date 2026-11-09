import { describe, expect, it } from "vitest";
import { ApiError, OFFLINE, createApi, serverTime } from "./api";
import { parseRoute } from "./route";

const res = (status: number, body: unknown, type = "application/json") =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": type } });

describe("api", () => {
  it("takes the CSRF token from the session and sends it on every change", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const links = { signin_url: "https://chatter.kevsrobots.com/login", signup_url: "s", account_url: "a" };
    const api = createApi("api/", async (url, init) => {
      seen.push({ url, init });
      if (url.includes("auth/session")) return res(200, { user: { id: 1, username: "kev", email: null }, csrf_token: "tok", ...links });
      if (url.endsWith("account")) return res(200, { id: 1, username: "kev", name: "kev", email: null, theme: null, csrf: "tok" });
      return res(200, { version: 2 });
    });
    const me = await api.me();
    expect(me?.name).toBe("kev");
    expect((await api.links("#/account")).signin_url).toBe(links.signin_url);
    expect(seen.at(-1)!.url).toBe("api/auth/session?next=%23%2Faccount");
    await api.save("m1", "{}", { ifMatch: 1, note: "x" });
    const put = seen.at(-1)!;
    expect(put.url).toBe("api/models/m1");
    expect(put.init?.method).toBe("PUT");
    expect((put.init?.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok");
    expect((put.init?.headers as Record<string, string>)["If-Match"]).toBe("1");
  });

  it("is signed out when the session has no user", async () => {
    expect(await createApi("api/", async () => res(200, { user: null, csrf_token: "anon" })).me()).toBeNull();
  });

  it("is signed out on 401 and has no server on HTML or a bare 5xx", async () => {
    expect(await createApi("api/", async () => res(401, { detail: "Sign in to do that." })).me()).toBeNull();
    await expect(createApi("api/", async () => res(200, "<!doctype html>", "text/html")).me()).rejects.toMatchObject({ status: 0 });
    await expect(createApi("api/", async () => res(502, "Bad gateway", "text/plain")).me()).rejects.toMatchObject({ status: 0, message: OFFLINE });
    await expect(
      createApi("api/", async () => {
        throw new TypeError("network");
      }).list(),
    ).rejects.toMatchObject({ status: 0 });
  });

  it("passes the server's message and the conflict's details on", async () => {
    const api = createApi("api/", async () => res(409, { detail: { message: "This model changed in another tab.", version: 4 } }));
    const e = (await api.save("m", "{}").catch((x) => x)) as ApiError;
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(409);
    expect(e.message).toBe("This model changed in another tab.");
    expect(e.data).toEqual({ message: "This model changed in another tab.", version: 4 });
    const big = createApi("api/", async () => res(413, "<html>too large</html>", "text/html"));
    await expect(big.create("x", "{}")).rejects.toMatchObject({ status: 413, message: "That's too big to save." });
  });

  it("reads server times as UTC", () => {
    expect(serverTime("2026-11-07 09:00:00.000")).toBe(Date.UTC(2026, 10, 7, 9));
  });
});

describe("routes", () => {
  it("reads the hash", () => {
    expect(parseRoute("")).toEqual({ page: "editor" });
    expect(parseRoute("#/edit/m%201")).toEqual({ page: "editor", model: "m 1" });
    expect(parseRoute("#/sample/bracket")).toEqual({ page: "editor", sample: "bracket" });
    expect(parseRoute("#/signin?next=%23%2Flibrary")).toEqual({ page: "signin", next: "#/library" });
    expect(parseRoute("#/library/bin")).toEqual({ page: "library", bin: true });
    expect(parseRoute("#/view/abc")).toEqual({ page: "view", token: "abc" });
    expect(parseRoute("#/view")).toEqual({ page: "editor" });
    expect(parseRoute("#/gallery")).toEqual({ page: "gallery" });
    expect(parseRoute("#/admin")).toEqual({ page: "admin" });
  });
});
