import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { newSheet, type Drawing, type TitleLogo } from "@bettercad/kernel/drawing";
import { SheetArt } from "./Sheet";
import SheetCard from "./SheetCard";
import { sheetLayout } from "./layout";
import { loadLocal, saveLocal, type DrawingTemplate, type TemplateApi } from "./templates";

beforeEach(() => localStorage.clear());

const logo: TitleLogo = { data: "data:image/jpeg;base64,/9j/2Q==", w: 300, h: 100 };
const sheet = { ...newSheet("Sheet 1", { size: "A3", title: "Bracket", author: "Kev" }), id: "s1" };
const drawing: Drawing = { id: "dr1", name: "Drawing 1", decimals: 2, sheets: [sheet] };
const workshop: DrawingTemplate = {
  id: "dt_1",
  name: "Workshop A3",
  size: "A3",
  landscape: false,
  standard: "asme",
  border: false,
  title: { approved: "Kev" },
  logo,
  fields: [{ label: "Material", value: "PETG" }],
  views: "four",
};

describe("the title block's logo and your own fields", () => {
  it("Sheet settings adds a logo and fields, and Done hands them back", async () => {
    const onDone = vi.fn();
    const logoOf = vi.fn(() => Promise.resolve(logo));
    render(<SheetCard sheet={sheet} drawing={drawing} logoOf={logoOf} onCancel={vi.fn()} onDone={onDone} />);
    const card = within(screen.getByRole("dialog", { name: "Sheet settings" }));
    await userEvent.upload(card.getByLabelText("Logo picture"), new File(["x"], "logo.png", { type: "image/png" }));
    expect(await card.findByRole("img", { name: "The logo in the title block" })).toBeTruthy();
    expect(card.getByRole("button", { name: "Change picture" })).toBeTruthy();
    await userEvent.click(card.getByRole("button", { name: "Add a field" }));
    await userEvent.type(card.getByRole("textbox", { name: "Field 1 name" }), "Material");
    await userEvent.type(card.getByRole("textbox", { name: "Field 1 value" }), "PETG");
    // A field left blank is not kept.
    await userEvent.click(card.getByRole("button", { name: "Add a field" }));
    await userEvent.click(card.getByRole("button", { name: "Done" }));
    expect(onDone.mock.calls[0]![0]).toMatchObject({ logo, fields: [{ label: "Material", value: "PETG" }] });
  });

  it("starts from the drawing's own, removes them, and stops at eight fields", async () => {
    const onDone = vi.fn();
    const fields = Array.from({ length: 8 }, (_, i) => ({ label: `F${i + 1}`, value: "x" }));
    render(<SheetCard sheet={sheet} drawing={{ ...drawing, logo, fields }} onCancel={vi.fn()} onDone={onDone} />);
    expect(screen.getByRole("button", { name: "Add a field" }).getAttribute("aria-disabled")).toBe("true");
    for (let i = 8; i >= 2; i--) await userEvent.click(screen.getByRole("button", { name: `Remove field ${i}` }));
    await userEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    const choice = onDone.mock.calls[0]![0] as { logo?: TitleLogo; fields?: unknown };
    expect(choice.logo).toBeUndefined();
    expect(choice.fields).toEqual([{ label: "F1", value: "x" }]);
  });

  it("says so when the file isn't a picture", async () => {
    render(<SheetCard sheet={sheet} drawing={drawing} logoOf={() => Promise.reject(new Error("no"))} onCancel={vi.fn()} onDone={vi.fn()} />);
    await userEvent.upload(screen.getByLabelText("Logo picture"), new File(["x"], "notes.txt", { type: "text/plain" }), { applyAccept: false });
    expect(await screen.findByText("That file isn't a picture BetterCad can read. Try a PNG or a JPEG.")).toBeTruthy();
  });

  it("draws them on the sheet: the logo as a picture, each field named for a screen reader", () => {
    const l = sheetLayout(sheet, { logo, fields: [{ label: "Material", value: "PETG" }] });
    render(
      <svg>
        <SheetArt layout={l} />
      </svg>,
    );
    const block = within(screen.getByRole("group", { name: "Title block" }));
    expect(block.getByRole("img", { name: "Logo: a picture" }).querySelector("image")?.getAttribute("href")).toBe(logo.data);
    expect(block.getByRole("img", { name: "Material: PETG" })).toBeTruthy();
  });
});

describe("drawing templates in the set-up card", () => {
  it("saves the sheet as a template, and New drawing starts from it in one pick", async () => {
    const { unmount } = render(
      <SheetCard sheet={{ ...sheet, title: { ...sheet.title, approved: "Kev" } }} drawing={{ ...drawing, logo }} onCancel={vi.fn()} onDone={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Save template" }).getAttribute("aria-disabled")).toBe("true");
    await userEvent.type(screen.getByRole("textbox", { name: "Template name" }), "Workshop A3");
    await userEvent.click(screen.getByRole("checkbox", { name: "Start with front, top, side and isometric views" }));
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(screen.getByRole("status").textContent).toBe("Saved as Workshop A3. Pick it under Template when you make a new drawing.");
    const [saved] = loadLocal();
    // The title and the date are each drawing's own.
    expect(saved).toMatchObject({
      name: "Workshop A3",
      size: "A3",
      standard: "iso",
      views: "four",
      logo,
      title: { approved: "Kev", author: "Kev", revision: "A" },
    });
    expect(saved!.title).not.toHaveProperty("title");
    expect(saved!.title).not.toHaveProperty("date");
    unmount();

    const onDone = vi.fn();
    render(<SheetCard onCancel={vi.fn()} onDone={onDone} />);
    const card = within(screen.getByRole("dialog", { name: "New drawing" }));
    await userEvent.selectOptions(card.getByRole("combobox", { name: "Page size" }), "A4");
    await userEvent.selectOptions(card.getByRole("combobox", { name: "Template" }), "Workshop A3");
    expect((card.getByRole("combobox", { name: "Page size" }) as HTMLSelectElement).value).toBe("A3");
    expect((card.getByRole("combobox", { name: "First views" }) as HTMLSelectElement).value).toBe("four");
    await userEvent.click(card.getByRole("button", { name: "Create" }));
    expect(onDone.mock.calls[0]![0]).toMatchObject({ size: "A3", standard: "iso", views: "four", logo, block: { approved: "Kev" } });
  });

  it("starts New drawing from your default, which you set and clear on the card", async () => {
    saveLocal([workshop, { ...workshop, id: "dt_2", name: "Plain A4", size: "A4", views: "none" }]);
    const first = render(<SheetCard onCancel={vi.fn()} onDone={vi.fn()} />);
    // No default yet: the page you last used, and no template picked.
    expect((screen.getByRole("combobox", { name: "Template" }) as HTMLSelectElement).value).toBe("");
    expect(screen.queryByRole("checkbox", { name: "Start new drawings from this" })).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Template" }), "dt_1");
    await userEvent.click(screen.getByRole("checkbox", { name: "Start new drawings from this" }));
    expect(loadLocal().map((t) => !!t.default)).toEqual([true, false]);
    first.unmount();

    const onDone = vi.fn();
    const second = render(<SheetCard onCancel={vi.fn()} onDone={onDone} />);
    expect((screen.getByRole("combobox", { name: "Template" }) as HTMLSelectElement).value).toBe("dt_1");
    expect((screen.getByRole("combobox", { name: "Standard" }) as HTMLSelectElement).value).toBe("asme");
    expect(screen.getByRole("button", { name: "Portrait" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onDone.mock.calls[0]![0]).toMatchObject({ size: "A3", landscape: false, border: false, standard: "asme", views: "four", fields: workshop.fields });
    second.unmount();

    render(<SheetCard onCancel={vi.fn()} onDone={vi.fn()} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Start new drawings from this" }));
    expect(loadLocal().some((t) => t.default)).toBe(false);
  });

  it("None goes back to a plain drawing, and Delete template takes one off the list", async () => {
    saveLocal([{ ...workshop, default: true }]);
    const onDone = vi.fn();
    render(<SheetCard onCancel={vi.fn()} onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Delete template" }));
    expect(loadLocal()).toEqual([]);
    expect(screen.queryByRole("combobox", { name: "Template" })).toBeNull();
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "First views" }), "none");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    const choice = onDone.mock.calls[0]![0] as object;
    expect(choice).not.toHaveProperty("block");
    expect(choice).not.toHaveProperty("logo");
    expect(choice).not.toHaveProperty("views");
  });

  it("saving under a name you already have replaces that template", async () => {
    saveLocal([{ ...workshop, default: true }]);
    render(<SheetCard sheet={{ ...sheet, size: "A2" }} drawing={drawing} onCancel={vi.fn()} onDone={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Template name" }), "workshop a3");
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(loadLocal()).toMatchObject([{ id: "dt_1", name: "workshop a3", size: "A2", default: true, views: "none" }]);
    expect(loadLocal()[0]).not.toHaveProperty("logo");
  });

  it("keeps up to 20, and says so at the limit", async () => {
    saveLocal(Array.from({ length: 20 }, (_, i) => ({ ...workshop, id: `dt_${i}`, name: `Template ${i}` })));
    render(<SheetCard sheet={sheet} drawing={drawing} onCancel={vi.fn()} onDone={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Template name" }), "One more");
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(screen.getByRole("status").textContent).toBe("You can keep up to 20 templates. Delete one to add another.");
    expect(loadLocal()).toHaveLength(20);
  });

  it("signed in, templates come from your account, this browser's go up, and changes are sent", async () => {
    saveLocal([{ ...workshop, id: "dt_here", name: "Made offline" }]);
    const calls: [string, string, unknown?][] = [];
    const api: TemplateApi = {
      call: <T,>(method: string, path: string, body?: unknown) => {
        calls.push([method, path, body]);
        return Promise.resolve((method === "GET" ? { templates: [{ ...workshop, default: true, modified: "2026-11-23 03:00:00.000" }] } : {}) as T);
      },
    };
    render(<SheetCard sheet={sheet} drawing={drawing} api={api} signedIn onCancel={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("Templates are kept in your account.");
    await waitFor(() => expect(loadLocal().map((t) => t.name)).toEqual(["Made offline", "Workshop A3"]));
    expect(calls[0]).toEqual(["GET", "templates", undefined]);
    expect(calls[1]).toMatchObject(["PUT", "templates/dt_here", { name: "Made offline", data: { size: "A3", views: "four" } }]);
    expect(calls[1]![2]).not.toHaveProperty("data.id");
    await userEvent.type(screen.getByRole("textbox", { name: "Template name" }), "Plain");
    await userEvent.click(screen.getByRole("button", { name: "Save template" }));
    expect(calls.at(-1)).toMatchObject(["PUT", expect.stringMatching(/^templates\/dt_/), { name: "Plain", data: { size: "A3", views: "none" } }]);
    expect(calls).toHaveLength(3);
  });

  it("a default that arrives from your account after the card opens still starts the new drawing", async () => {
    const api: TemplateApi = { call: <T,>() => Promise.resolve({ templates: [{ ...workshop, default: true }] } as T) };
    const onDone = vi.fn();
    render(<SheetCard api={api} signedIn onCancel={vi.fn()} onDone={onDone} />);
    await waitFor(() => expect((screen.getByRole("combobox", { name: "Template" }) as HTMLSelectElement).value).toBe("dt_1"));
    expect((screen.getByRole("combobox", { name: "Page size" }) as HTMLSelectElement).value).toBe("A3");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onDone.mock.calls[0]![0]).toMatchObject({ standard: "asme", views: "four", block: { approved: "Kev" } });
  });

  it("signed out, it says where templates are kept and asks the account nothing", () => {
    const call = vi.fn();
    render(<SheetCard sheet={sheet} drawing={drawing} api={{ call }} onCancel={vi.fn()} onDone={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toBe("Templates are kept in this browser. Sign in to keep them in your account.");
    expect(call).not.toHaveBeenCalled();
  });
});
