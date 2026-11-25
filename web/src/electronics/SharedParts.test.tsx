import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BASICS, emptyDesign, emptyPack, inflate, placePart, putPart, type ElectronicsDesign, type LibraryPack } from "@bettercad/electronics";
import { AccountProvider } from "../cloud/account";
import { createApi } from "../cloud/api";
import { ComponentsCard } from "./Components";
import { creditOf, publishPack, shareToken } from "./sharedParts";
import { eui } from "./ui";

const starter = JSON.parse(readFileSync(join(__dirname, "../../../packages/electronics/library/starter.json"), "utf8")) as LibraryPack;
const load = vi.hoisted(() => vi.fn());
vi.mock("./starter", () => ({ loadStarter: load, basicsPack: () => starter }));

afterEach(() => {
  act(() => eui.reset());
  localStorage.clear();
  load.mockReset();
});

const shunt = { ...BASICS.resistor!(), name: "Shunt 10 mΩ", value: "10 mΩ", source: { library: "ada", licence: "CC-BY 4.0" } };
const TOKEN = "abcdefghij0123456789xy";

/** A server that keeps a library, a link to it and a catalogue, and notes what it was asked. */
function server(signedIn: boolean, o: { library?: LibraryPack; catalogue?: LibraryPack; status?: string } = {}) {
  const asked: { method: string; url: string; body?: unknown }[] = [];
  let library: LibraryPack | null = o.library ?? null;
  let token: string | null = null;
  const mine: { part: string; status: string }[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const api = createApi("api/", async (url, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    asked.push({ method, url, body });
    if (url.startsWith("api/auth/session"))
      return json({
        user: signedIn ? { id: 1, username: "kev", email: "k@example.com" } : null,
        csrf_token: "t",
        signin_url: "",
        signup_url: "",
        account_url: "",
      });
    if (url === "api/account") return json({ id: 1, username: "kev", name: "kev", email: "k@example.com", theme: null, csrf: "t" });
    if (url === "api/parts-library" && method === "GET") return json({ pack: library });
    if (url === "api/parts-library") return ((library = (body as { pack?: LibraryPack }).pack ?? (body as LibraryPack)), json({ ok: true }));
    if (url === "api/parts-library/share" && method === "GET") return json({ token });
    if (url === "api/parts-library/share" && method === "POST") return json({ token: (token = TOKEN) });
    if (url === "api/parts-library/share") return ((token = null), json({ ok: true }));
    if (url === `api/parts-library/shared/${TOKEN}`) return json({ pack: putPart(emptyPack("ada"), "shunt", shunt, "Sensors"), by: "ada" });
    if (url.startsWith("api/parts-library/shared/")) return json({ detail: "That link no longer works. Ask for a new one." }, 404);
    if (url === "api/parts-catalogue/mine" && method === "GET") return json({ parts: mine });
    if (url.startsWith("api/parts-catalogue/mine/")) return (mine.splice(0), json({ ok: true }));
    if (url === "api/parts-catalogue" && method === "POST") {
      mine.push({ part: (body as { id: string }).id, status: "unreviewed" });
      return json({ id: 7, status: "unreviewed" });
    }
    if (url.startsWith("api/parts-catalogue?q="))
      return json({
        parts: o.catalogue
          ? [
              {
                id: 7,
                name: "Shunt 10 mΩ",
                licence: "CC-BY 4.0",
                credit: "ada",
                by: "ada",
                status: o.status ?? "unreviewed",
                modified: "2026-11-24 10:00:00",
                pack: o.catalogue,
              },
            ]
          : [],
      });
    return json({ detail: "nope" }, 404);
  });
  return { api, asked, library: () => library };
}

async function open(
  s: ReturnType<typeof server>,
  props: { design?: ElectronicsDesign; edit?: (f: (d: ElectronicsDesign) => ElectronicsDesign, label: string) => void } = {},
) {
  load.mockResolvedValue(starter);
  render(
    <AccountProvider api={s.api}>
      <ComponentsCard onClose={() => {}} {...props} />
    </AccountProvider>,
  );
  const card = screen.getByRole("group", { name: "Components options" });
  await within(card).findByRole("list", { name: "Parts" });
  return card;
}

describe("the shared parts catalogue (#625, #629)", () => {
  it("lists what other makers published under your own, says which are unchecked, and keeps a copy when asked", async () => {
    const s = server(true, { catalogue: publishPack("shunt", shunt, "Sensors", "CC-BY 4.0", "ada") });
    const card = await open(s);
    await userEvent.type(within(card).getByLabelText("Find a part"), "shunt");
    const shared = await within(card).findByRole("list", { name: "From other makers" });
    expect(within(shared).getByRole("button", { name: /Shunt 10 mΩ/ })).toHaveTextContent("Unreviewed");
    expect(s.asked.filter((a) => a.url.startsWith("api/parts-catalogue?q=")).map((a) => a.url)).toEqual(["api/parts-catalogue?q=shunt"]);
    await userEvent.click(within(shared).getByRole("button", { name: /Shunt 10 mΩ/ }));
    const part = within(card).getByRole("region", { name: "Shunt 10 mΩ" });
    expect(part).toHaveTextContent("Published by ada. Not checked yet: hold it against the datasheet before you order a board.");
    expect(part).toHaveTextContent("From ada, CC-BY 4.0.");
    await userEvent.click(within(part).getByRole("button", { name: "Add to your parts" }));
    expect(
      within(card)
        .getAllByRole("status")
        .some((n) => n.textContent?.includes("Shunt 10 mΩ is in your parts.")),
    ).toBe(true);
    await userEvent.click(within(card).getByRole("button", { name: "Place" }));
    expect(eui.get().placing).toMatchObject({ name: "Shunt 10 mΩ", source: { library: "ada", licence: "CC-BY 4.0" } });
  });

  it("marks a checked part as shared, signed in or not", async () => {
    const s = server(false, { catalogue: publishPack("shunt", shunt, "Sensors", "CC-BY 4.0", "ada"), status: "approved" });
    const card = await open(s);
    await userEvent.type(within(card).getByLabelText("Find a part"), "shunt");
    const shared = await within(card).findByRole("list", { name: "From other makers" });
    await userEvent.click(within(shared).getByRole("button", { name: /Shunt 10 mΩ/ }));
    expect(within(card).getByRole("region", { name: "Shunt 10 mΩ" })).toHaveTextContent("Published by ada. Checked by BetterCad.");
  });

  it("publishes one of your parts under a licence you choose, and takes it back", async () => {
    const s = server(true, { library: putPart(emptyPack("You"), "shunt", { ...shunt, source: { library: "You", licence: "MIT" } }, "Sensors") });
    const card = await open(s);
    await userEvent.type(await within(card).findByLabelText("Find a part"), "shunt");
    await userEvent.click(await within(card).findByRole("button", { name: /Shunt 10 mΩ/ }));
    const box = within(card).getByRole("group", { name: "Shared catalogue" });
    expect(within(box).getByLabelText("Licence to publish under")).toHaveValue("MIT");
    await userEvent.selectOptions(within(box).getByLabelText("Licence to publish under"), "CC-BY-SA 4.0");
    expect(box).toHaveTextContent("Credit: kev.");
    await userEvent.click(within(box).getByRole("button", { name: "Publish" }));
    await within(box).findByRole("button", { name: "Publish again" });
    const sent = s.asked.find((a) => a.url === "api/parts-catalogue" && a.method === "POST")!.body as {
      id: string;
      licence: string;
      credit: string;
      pack: LibraryPack;
    };
    expect(sent).toMatchObject({ id: "shunt", licence: "CC-BY-SA 4.0", credit: "kev" });
    expect(sent.pack.parts).toHaveLength(1);
    expect(inflate(sent.pack, sent.pack.parts[0]!).source).toMatchObject({ library: "kev", licence: "CC-BY-SA 4.0" });
    expect(within(box).getByRole("status")).toHaveTextContent("Published. It shows as Unreviewed until it is checked.");
    await userEvent.click(within(box).getByRole("button", { name: "Unpublish" }));
    await within(box).findByRole("button", { name: "Publish" });
    expect(s.asked.some((a) => a.method === "DELETE" && a.url === "api/parts-catalogue/mine/shunt")).toBe(true);
  });

  it("asks you to sign in before you publish", async () => {
    localStorage.setItem("bettercad.electronics.library", JSON.stringify({ pack: putPart(emptyPack("You"), "shunt", shunt, "Sensors"), removed: [] }));
    const card = await open(server(false));
    await userEvent.type(within(card).getByLabelText("Find a part"), "shunt");
    await userEvent.click(within(card).getByRole("button", { name: /Shunt 10 mΩ/ }));
    expect(within(card).getByText("Sign in to publish this part to the shared catalogue.")).toBeInTheDocument();
  });

  it("makes a link to your parts, stops it, and adds the parts behind someone else's link", async () => {
    const s = server(true, { library: putPart(emptyPack("You"), "mine", { ...shunt, name: "My part" }, "Sensors") });
    const card = await open(s);
    await userEvent.click(await within(card).findByRole("button", { name: "Share by link" }));
    const link = await within(card).findByLabelText("Link to your parts");
    expect((link as HTMLInputElement).value).toMatch(new RegExp(`/api/parts-library/shared/${TOKEN}$`));
    expect(shareToken((link as HTMLInputElement).value)).toBe(TOKEN);
    await userEvent.click(within(card).getByRole("button", { name: "Stop sharing" }));
    await waitFor(() => expect(within(card).queryByLabelText("Link to your parts")).not.toBeInTheDocument());

    await userEvent.click(within(card).getByRole("button", { name: "Add from a link" }));
    await userEvent.type(within(card).getByLabelText("Link to a library"), "not a link");
    await userEvent.click(within(card).getByRole("button", { name: "Add its parts" }));
    expect(within(card).getByText("That is not a link to a BetterCad parts library.")).toBeInTheDocument();
    await userEvent.clear(within(card).getByLabelText("Link to a library"));
    await userEvent.type(within(card).getByLabelText("Link to a library"), `https://bettercad.example/api/parts-library/shared/${TOKEN}`);
    await userEvent.click(within(card).getByRole("button", { name: "Add its parts" }));
    expect(await within(card).findByText("Added 1 part from ada's library.")).toBeInTheDocument();
    expect(within(card).getByLabelText("Shelf")).toHaveValue("@mine");
    expect(within(within(card).getByRole("list", { name: "Parts" })).getByRole("button", { name: /Shunt 10 mΩ/ })).toBeInTheDocument();
  });

  it("offers to update the parts in a design that keep an older copy", async () => {
    const old = { ...shunt, value: "5 mΩ" };
    const design = placePart(emptyDesign(), "sh1", old, { x: 0, y: 0 }).design;
    const edit = vi.fn();
    const s = server(true, { library: putPart(emptyPack("ada"), "shunt", shunt, "Sensors") });
    const card = await open(s, { design, edit });
    await userEvent.type(await within(card).findByLabelText("Find a part"), "shunt");
    await userEvent.click(await within(card).findByRole("button", { name: /Shunt 10 mΩ/ }));
    const ref = design.parts[0]!.ref;
    await userEvent.click(within(card).getByRole("button", { name: `Update ${ref}` }));
    expect(edit).toHaveBeenCalledWith(expect.any(Function), "Update Shunt 10 mΩ");
    const next = (edit.mock.calls[0]![0] as (d: ElectronicsDesign) => ElectronicsDesign)(design);
    expect(next.defs[next.parts[0]!.def]!.value).toBe("10 mΩ");
    expect(within(card).getByText(`Updated ${ref} to Shunt 10 mΩ as it is now.`)).toBeInTheDocument();
  });

  it("credits a part to where it came from, or to you when you drew it", () => {
    expect(creditOf(shunt, "kev")).toBe("ada");
    expect(creditOf({ ...shunt, source: { library: "You", licence: "MIT" } }, "kev")).toBe("kev");
    expect(shareToken("nonsense!")).toBeNull();
  });
});
