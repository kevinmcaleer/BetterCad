import { fireEvent, render, screen } from "@testing-library/react";
import { AccountProvider } from "../cloud/account";
import { createApi, type AdminUser } from "../cloud/api";
import { AdminPage } from "./Admin";

const ada: AdminUser = {
  id: 101,
  username: "ada",
  email: "ada@example.com",
  joined: "2026-11-01 10:00:00",
  last_active: null,
  visits: [
    { started: "2026-11-08 12:00:00", ended: "2026-11-08 13:20:00" },
    { started: "2026-11-07 09:00:00", ended: "2026-11-07 09:01:00" },
  ],
  visits_month: 2,
  last_seen: "2026-11-08",
  set_aside: false,
  last_saved: "2026-11-08 12:00:00",
  size: 3072,
  projects: [
    {
      id: "p1",
      name: "Rover",
      created: "2026-11-02 10:00:00",
      modified: "2026-11-08 12:00:00",
      deleted_at: null,
      models: 1,
      size: 2048,
      cover: null,
      thumbnail: "/api/admin/models/m1/thumbnail?v=3",
    },
  ],
  models: [
    {
      id: "m1",
      name: "Rover chassis",
      version: 3,
      versions: 3,
      size: 2048,
      created: "2026-11-02 10:00:00",
      modified: "2026-11-08 12:00:00",
      deleted_at: null,
      shared: true,
      project_id: "p1",
      thumbnail: "/api/admin/models/m1/thumbnail?v=3",
    },
    {
      id: "m2",
      name: "Old gripper",
      version: 1,
      versions: 1,
      size: 1024,
      created: "2026-11-02 10:00:00",
      modified: "2026-11-03 12:00:00",
      deleted_at: "2026-11-04 12:00:00",
      shared: false,
      project_id: null,
      thumbnail: null,
    },
  ],
};
const bob: AdminUser = { ...ada, id: 102, username: "bob", email: null, size: 0, projects: [], models: [], visits: [], visits_month: 0, last_seen: null };

function mount(admin: boolean) {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const api = createApi("api/", async (url) => {
    if (url.startsWith("api/auth/session"))
      return json({ user: { id: 1, username: "kev", email: "kev@example.com" }, csrf_token: "t", signin_url: "", signup_url: "", account_url: "" });
    if (url === "api/account") return json({ id: 1, username: "kev", name: "kev", email: "kev@example.com", theme: null, csrf: "t", admin });
    if (url === "api/admin/users") return json({ users: [ada, bob], totals: { users: 2, models: 2, size: 3072 } });
    return json({ detail: "nope" }, 404);
  });
  return render(
    <AccountProvider api={api}>
      <AdminPage />
    </AccountProvider>,
  );
}

describe("admin console", () => {
  it("lists every user with the models they've saved", async () => {
    mount(true);
    const users = await screen.findByRole("list", { name: "Users" });
    expect(screen.getByRole("status")).toHaveTextContent("2 users, 1 project, 2 models saved");
    expect(users).toHaveTextContent("ada");
    expect(users).toHaveTextContent("1 project, 1 model, 1 in the bin");
    expect(users).toHaveTextContent("ada@example.com");
    expect(users).toHaveTextContent("2 visits in 30 days");
    expect(users).toHaveTextContent("Last signed in not recorded");
    const models = screen.getByRole("list", { name: "ada's models" });
    expect(models).toHaveTextContent("Rover chassis");
    expect(models).toHaveTextContent("3 versions");
    expect(models).toHaveTextContent("Shared");
    expect(models).toHaveTextContent("In the bin");
    expect(models).toHaveTextContent("In Rover");
    const projects = screen.getByRole("list", { name: "ada's projects" });
    expect(projects).toHaveTextContent("Rover");
    expect(projects).toHaveTextContent("1 model · 2 KB");
    const signIns = screen.getByRole("list", { name: "ada's sign-ins" });
    expect(signIns).toHaveTextContent("1 h 20 min");
    expect(signIns).toHaveTextContent("a few minutes");
  });

  it("finds a user by one of their models", async () => {
    mount(true);
    await screen.findByRole("list", { name: "Users" });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search users, projects and models" }), { target: { value: "rover" } });
    expect(screen.getByRole("list", { name: "Users" })).toHaveTextContent("ada");
    expect(screen.getByRole("list", { name: "Users" })).not.toHaveTextContent("bob");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search users, projects and models" }), { target: { value: "zzz" } });
    expect(screen.getByText("Nobody matches ‘zzz’.")).toBeInTheDocument();
  });

  it("turns away accounts that aren't admins", async () => {
    mount(false);
    expect(await screen.findByText("Only BetterCad’s admins can see this page.")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Users" })).toBeNull();
  });
});
