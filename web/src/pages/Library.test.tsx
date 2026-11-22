import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AccountProvider } from "../cloud/account";
import { createApi } from "../cloud/api";
import { Library } from "./Library";
import { Readme } from "./Readme";
import { writeStl } from "@bettercad/kernel/mesh-files";

const stlFile = (name: string) => {
  const bytes = writeStl("t", [{ name: "t", triangles: Float32Array.of(0, 0, 0, 10, 0, 0, 0, 10, 0) }]);
  return { name, arrayBuffer: async () => bytes } as unknown as File;
};

/** A small in-memory server for the library's folder and project routes (#273, #274). */
function server() {
  const folders: Record<string, { id: string; name: string; parent_id: string | null; project_id: string | null }> = {
    parts: { id: "parts", name: "Parts", parent_id: null, project_id: null },
  };
  const projects: Record<string, { id: string; name: string; readme: string }> = {
    rover: { id: "rover", name: "Rover", readme: "# Rover\n\nSix **wheels**." },
  };
  const models: Record<string, { id: string; name: string; folder_id: string | null; project_id: string | null }> = {
    m1: { id: "m1", name: "Wheel", folder_id: null, project_id: null },
    m2: { id: "m2", name: "Bolt", folder_id: "parts", project_id: null },
    m3: { id: "m3", name: "Chassis", folder_id: null, project_id: "rover" },
    m4: { id: "m4", name: "Arm", folder_id: null, project_id: "rover" },
    m5: { id: "m5", name: "Gripper", folder_id: null, project_id: "rover" },
    m6: { id: "m6", name: "Mast", folder_id: null, project_id: "rover" },
  };
  const calls: string[] = [];
  const binned = new Set<string>();
  // Set to make the models list fail the way a real one can: a sign-in that ran out, or a proxy with no server.
  const fail: { with: (() => Response) | null } = { with: null };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const summary = (m: (typeof models)[string]) => ({
    ...m,
    version: 1,
    created: "2026-11-13 10:00:00",
    modified: "2026-11-13 10:00:00",
    deleted_at: null,
    thumbnail: null,
  });
  const api = createApi("api/", async (url, init) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : {};
    calls.push(`${method} ${url}`);
    const u = new URL(url, "http://x/");
    if (url.startsWith("api/auth/session"))
      return json({ user: { id: 1, username: "kev", email: null }, csrf_token: "t", signin_url: "", signup_url: "", account_url: "" });
    if (url === "api/account") return json({ id: 1, username: "kev", name: "kev", email: null, theme: null, csrf: "t" });
    if (url === "api/me/usage") return json({ models: 2, bytes: 0, quota: 1 });
    if (u.pathname === "/api/places")
      return json(
        u.searchParams.get("bin")
          ? { folders: [], projects: [] }
          : {
              folders: Object.values(folders).map((f) => ({
                ...f,
                created: "",
                modified: "",
                deleted_at: null,
                models: Object.values(models).filter((m) => m.folder_id === f.id).length,
                folders: 0,
              })),
              projects: Object.values(projects).map((p) => ({ ...p, cover: null, created: "", modified: "", deleted_at: null, models: 0 })),
            },
      );
    if (u.pathname === "/api/models" && method === "GET") {
      if (fail.with) return fail.with();
      const q = u.searchParams.get("q");
      const f = u.searchParams.get("folder");
      const p = u.searchParams.get("project");
      const top = u.searchParams.get("top");
      const list = Object.values(models).filter((m) =>
        binned.has(m.id) !== !!u.searchParams.get("bin")
          ? false
          : q
            ? m.name.toLowerCase().includes(q.toLowerCase())
            : f
              ? m.folder_id === f
              : p
                ? m.project_id === p && !m.folder_id
                : top
                  ? !m.folder_id && !m.project_id
                  : true,
      );
      return json({ models: list.map(summary), total: list.length });
    }
    const bulk = /^\/api\/models\/bulk\/(move|delete|restore)$/.exec(u.pathname);
    if (bulk && method === "POST") {
      for (const id of body.ids as string[]) {
        const m = models[id]!;
        if (bulk[1] === "move") {
          m.folder_id = body.folder_id ?? null;
          m.project_id = body.folder_id ? (folders[body.folder_id]?.project_id ?? null) : (body.project_id ?? null);
        } else binned[bulk[1] === "delete" ? "add" : "delete"](id);
      }
      return json({ ok: true });
    }
    const move = /^\/api\/models\/(\w+)\/move$/.exec(u.pathname);
    if (move && method === "POST") {
      const m = models[move[1]!]!;
      m.folder_id = body.folder_id ?? null;
      m.project_id = body.folder_id ? (folders[body.folder_id]?.project_id ?? null) : (body.project_id ?? null);
      return json(summary(m));
    }
    if (u.pathname === "/api/models" && method === "POST") {
      const id = `m${Object.keys(models).length + 1}`;
      models[id] = { id, name: body.name, folder_id: body.folder_id ?? null, project_id: body.project_id ?? null };
      return json(summary(models[id]), 201);
    }
    if (u.pathname.startsWith("/api/blobs/")) return method === "HEAD" ? new Response(null, { status: 404 }) : json({ hash: "x", stored: true });
    if (u.pathname === "/api/folders" && method === "POST") {
      const id = `f${Object.keys(folders).length}`;
      folders[id] = { id, name: body.name, parent_id: body.parent_id ?? null, project_id: body.project_id ?? null };
      return json(folders[id], 201);
    }
    return json({ detail: "nope" }, 404);
  });
  return { api, calls, models, folders, fail, binned };
}

function mount(props: Parameters<typeof Library>[0] = {}) {
  const s = server();
  render(
    <AccountProvider api={s.api}>
      <Library {...props} />
    </AccountProvider>,
  );
  return s;
}

describe("library folders and projects", () => {
  it("shows projects, folders and the models at the top of My models", async () => {
    mount();
    expect(await screen.findByRole("button", { name: "Open project Rover" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Open folder Parts" })).toHaveTextContent("1 model");
    const models = screen.getByRole("list", { name: "Your models" });
    expect(within(models).getByRole("button", { name: "Open Wheel" })).toBeVisible();
    expect(within(models).queryByRole("button", { name: "Open Bolt" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Breadcrumbs" })).toBeNull();
  });

  it("shows what's inside a project on its card, a click from each model", async () => {
    mount();
    const peek = await screen.findByRole("list", { name: "Models in Rover" });
    const links = within(peek).getAllByRole("link");
    expect(links.slice(0, 3).map((a) => a.getAttribute("href"))).toEqual(["#/edit/m3", "#/edit/m4", "#/edit/m5"]);
    expect(within(peek).getByRole("link", { name: /Chassis/ })).toBeVisible();
    expect(within(peek).getByRole("link", { name: "See all 4 models" })).toHaveAttribute("href", "#/library/project/rover");
    expect(within(screen.getByRole("list", { name: "Your models" })).queryByRole("button", { name: "Open Chassis" })).toBeNull();
  });

  it("opens a folder with breadcrumbs back to My models", async () => {
    mount({ folder: "parts" });
    expect(await screen.findByRole("button", { name: "Open Bolt" })).toBeVisible();
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumbs" });
    expect(within(crumbs).getByRole("link", { name: "My models" })).toHaveAttribute("href", "#/library");
    expect(within(crumbs).getByText("Parts")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: "Parts" })).toBeInTheDocument();
  });

  it("shows a project's readme and members", async () => {
    mount({ project: "rover" });
    expect(await screen.findByRole("heading", { level: 2, name: "Rover" })).toBeVisible();
    expect(screen.getByText("wheels").tagName).toBe("STRONG");
    expect(screen.getByText("Owner")).toBeVisible();
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
  });

  it("moves a model into a folder with Move to…", async () => {
    const s = mount();
    fireEvent.click(await screen.findByRole("button", { name: "More for Wheel" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Move to…" }));
    const dialog = screen.getByRole("dialog", { name: "Move Wheel" });
    expect(within(dialog).getByRole("radio", { name: /My models/ })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("radio", { name: /Parts/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move here" }));
    expect(await screen.findByText("Moved Wheel to Parts")).toBeVisible();
    expect(s.models.m1!.folder_id).toBe("parts");
  });

  it("makes a folder where you are", async () => {
    const s = mount({ project: "rover" });
    fireEvent.click(await screen.findByRole("button", { name: "New folder" }));
    fireEvent.change(screen.getByLabelText("Folder name"), { target: { value: "Arm" } });
    fireEvent.click(screen.getByRole("button", { name: "Make" }));
    expect(await screen.findByText("Made the folder Arm")).toBeVisible();
    expect(Object.values(s.folders).find((f) => f.name === "Arm")?.project_id).toBe("rover");
  });

  it("uploads STL files into the project on show, each as a model", async () => {
    const s = mount({ project: "rover" });
    await screen.findByRole("button", { name: "Upload" });
    fireEvent.change(screen.getByLabelText("Files to upload"), { target: { files: [stlFile("Wheel hub.stl"), stlFile("Tyre.stl")] } });
    expect(await screen.findByText("Uploaded 2 models")).toBeVisible();
    // The upload card lists each file and the model it made.
    const card = screen.getByRole("region", { name: "Uploads" });
    expect(card).toHaveTextContent("2 models uploaded");
    expect(card).toHaveTextContent("Saved as Wheel hub");
    const made = Object.values(s.models).filter((m) => m.name === "Wheel hub" || m.name === "Tyre");
    expect(made.map((m) => m.project_id)).toEqual(["rover", "rover"]);
  });

  it("says on the upload card why a file didn't go up, and keeps it until closed", async () => {
    mount({ project: "rover" });
    await screen.findByRole("button", { name: "Upload" });
    const quiet = console.error;
    console.error = () => undefined;
    const bytes = new TextEncoder().encode("solid x\nendsolid x\n");
    const broken = { name: "Servo.stl", arrayBuffer: async () => bytes.buffer } as unknown as File;
    fireEvent.change(screen.getByLabelText("Files to upload"), { target: { files: [broken] } });
    expect(await screen.findByRole("alert")).toHaveTextContent("That STL file is damaged.");
    console.error = quiet;
    expect(screen.getByRole("region", { name: "Uploads" })).toHaveTextContent("Upload failed");
    expect(screen.getByText("1 file didn't upload")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Uploads" })).not.toBeInTheDocument();
  });

  it("uploads STL files dropped on the page", async () => {
    const s = mount({ folder: "parts" });
    await screen.findByRole("button", { name: "Open Bolt" });
    fireEvent.drop(window, { dataTransfer: { types: ["Files"], files: [stlFile("Nut.stl")] } });
    expect(await screen.findByText("Uploaded Nut")).toBeVisible();
    expect(Object.values(s.models).find((m) => m.name === "Nut")?.folder_id).toBe("parts");
  });

  it("searches every place and says where each result lives", async () => {
    const s = mount();
    await screen.findByRole("button", { name: "Open Wheel" });
    fireEvent.change(screen.getByLabelText("Search by name"), { target: { value: "bolt" } });
    await screen.findByRole("button", { name: "Open Bolt" });
    const results = screen.getByRole("list", { name: "Search results" });
    expect(within(results).getByText("Parts")).toBeVisible();
    await waitFor(() => expect(s.calls.some((c) => c.includes("q=bolt") && !c.includes("top="))).toBe(true));
  });
});

describe("library right-click and picking several models", () => {
  it("opens a model's menu with a right-click and renames it", async () => {
    mount();
    const card = (await screen.findByRole("button", { name: "Open Wheel" })).closest("li")!;
    fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });
    const menu = screen.getByRole("menu", { name: "Wheel menu" });
    expect(within(menu).getByRole("menuitem", { name: "Move to…" })).toBeVisible();
    expect(within(menu).getByRole("menuitem", { name: "Delete…" })).toBeVisible();
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    expect(screen.getByRole("textbox", { name: "New name" })).toHaveValue("Wheel");
  });

  it("opens a folder's menu with a right-click", async () => {
    mount();
    fireEvent.contextMenu((await screen.findByRole("button", { name: "Open folder Parts" })).closest("li")!);
    expect(within(screen.getByRole("menu", { name: "Parts menu" })).getByRole("menuitem", { name: "Rename" })).toBeVisible();
  });

  it("picks models with Ctrl-click and Shift-click and moves them together", async () => {
    const s = mount({ project: "rover" });
    fireEvent.click(await screen.findByRole("button", { name: "Open Chassis" }), { ctrlKey: true });
    const bar = screen.getByRole("toolbar", { name: "Selected models" });
    expect(bar).toHaveTextContent("1 selected");
    fireEvent.click(screen.getByRole("button", { name: "Open Gripper" }), { shiftKey: true });
    expect(bar).toHaveTextContent("3 selected");
    // While picking, a plain click picks too rather than opening.
    fireEvent.click(screen.getByRole("button", { name: "Open Mast" }));
    expect(bar).toHaveTextContent("4 selected");
    expect(screen.getByRole("checkbox", { name: "Select Mast" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Mast" }));
    expect(bar).toHaveTextContent("3 selected");
    fireEvent.click(within(bar).getByRole("button", { name: "Move to…" }));
    const dialog = screen.getByRole("dialog", { name: "Move 3 models" });
    fireEvent.click(within(dialog).getByRole("radio", { name: /Parts/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Move here" }));
    expect(await screen.findByText("Moved 3 models to Parts")).toBeVisible();
    expect(["m3", "m4", "m5", "m6"].map((id) => s.models[id]!.folder_id)).toEqual(["parts", "parts", "parts", null]);
    expect(screen.queryByRole("toolbar", { name: "Selected models" })).toBeNull();
  });

  it("deletes the picked models from a right-click, and Undo brings them back", async () => {
    const s = mount({ project: "rover" });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Arm" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Mast" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "Open Arm" }).closest("li")!);
    fireEvent.click(within(screen.getByRole("menu", { name: "2 selected menu" })).getByRole("menuitem", { name: "Delete 2 models…" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Delete 2 models?" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Moved 2 models to the bin")).toBeVisible();
    expect([...s.binned].sort()).toEqual(["m4", "m6"]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open Arm" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Restored 2 models")).toBeVisible();
    expect(s.binned.size).toBe(0);
    expect(await screen.findByRole("button", { name: "Open Arm" })).toBeVisible();
  });

  it("clears the selection with Esc", async () => {
    mount({ project: "rover" });
    fireEvent.click(await screen.findByRole("checkbox", { name: "Select Arm" }));
    expect(screen.getByRole("toolbar", { name: "Selected models" })).toBeVisible();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("toolbar", { name: "Selected models" })).toBeNull();
  });
});

describe("readme", () => {
  it("never passes HTML through and only links to web addresses", () => {
    render(<Readme src={"<b>hi</b> [ok](https://kevsrobots.com) [bad](javascript:alert(1))"} />);
    expect(screen.getByText(/<b>hi<\/b>/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ok" })).toHaveAttribute("href", "https://kevsrobots.com");
    expect(screen.queryByRole("link", { name: "bad" })).toBeNull();
  });
});

describe("library when the list can't be fetched", () => {
  it("asks you to log in again when the sign-in has run out, not that you're offline", async () => {
    const s = server();
    s.fail.with = () => new Response(JSON.stringify({ detail: "Sign in to do that." }), { status: 401, headers: { "Content-Type": "application/json" } });
    render(
      <AccountProvider api={s.api}>
        <Library />
      </AccountProvider>,
    );
    expect(await screen.findByText(/Your sign-in has run out/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Log in again" })).toBeVisible();
    expect(screen.queryByText(/offline/)).toBeNull();
  });

  it("says the server isn't answering, with the error, and Retry brings the models back", async () => {
    const s = server();
    s.fail.with = () => new Response("<html>Bad gateway</html>", { status: 502, headers: { "Content-Type": "text/html" } });
    render(
      <AccountProvider api={s.api}>
        <Library />
      </AccountProvider>,
    );
    expect(await screen.findByText(/BetterCad\u2019s server isn\u2019t answering just now \(error 502\)/)).toBeVisible();
    expect(screen.queryByText(/offline/)).toBeNull();
    s.fail.with = null;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Open Wheel" })).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry" })).toBeNull());
  });
});
