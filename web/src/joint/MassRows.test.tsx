import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MassRows } from "./MassRows";

const props = { mass: 42.4, com: [10, 0, 5.04] as [number, number, number], inertia: [1, 1, 1, 0, 0, 0] as [number, number, number, number, number, number] };

describe("MassRows", () => {
  it("shows a body's mass and how it was found, and its link's total and centre of mass", () => {
    render(<MassRows body={{ ...props, method: "shell" }} link={{ name: "Link 1", props: { ...props, mass: 80 } }} />);
    expect(screen.getByText("about 42 g")).toBeVisible();
    expect(screen.getByText(/solid walls and the infill/)).toBeVisible();
    expect(screen.getByText("about 80 g")).toBeVisible();
    expect(screen.getByText("10, 0, 5 mm")).toBeVisible();
  });

  it("takes a datasheet mass, and 0 goes back to the estimate", async () => {
    const onDatasheet = vi.fn();
    render(<MassRows datasheet={12} onDatasheet={onDatasheet} />);
    const field = screen.getByRole("textbox", { name: /^Datasheet mass/ });
    expect(field).toHaveValue("12");
    await userEvent.clear(field);
    await userEvent.type(field, "55{Enter}");
    expect(onDatasheet).toHaveBeenLastCalledWith(55);
    await userEvent.clear(field);
    await userEvent.type(field, "0{Enter}");
    expect(onDatasheet).toHaveBeenLastCalledWith(undefined);
  });
});
