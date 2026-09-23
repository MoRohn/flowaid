import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Select, SelectGroup, SelectItem } from "./Select";
import { FieldRow } from "./Field";
import { installDomStubs } from "./testStubs";

afterEach(cleanup);

beforeAll(() => installDomStubs());

function renderSelect(onValueChange = vi.fn()) {
  render(
    <Select placeholder="Pick a model" onValueChange={onValueChange} aria-label="Model">
      <SelectGroup label="Decision">
        <SelectItem value="jev-latest" description="calibrated">
          jev-latest
        </SelectItem>
        <SelectItem value="jev-mini">jev-mini</SelectItem>
      </SelectGroup>
      <SelectItem value="gpt-5-mini" disabled>
        gpt-5-mini
      </SelectItem>
    </Select>,
  );
  return onValueChange;
}

describe("Select", () => {
  it("shows the placeholder until a value is chosen", () => {
    renderSelect();
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent("Pick a model");
  });

  it("opens with the keyboard, moves with arrows and selects with Enter", async () => {
    const user = userEvent.setup();
    const onValueChange = renderSelect();
    const trigger = screen.getByRole("combobox", { name: "Model" });
    trigger.focus();
    await user.keyboard("{Enter}");
    const listbox = await screen.findByRole("listbox");
    expect(listbox).toBeInTheDocument();
    expect(screen.getByText("Decision")).toBeInTheDocument();
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.keyboard("{Enter}");
    expect(onValueChange).toHaveBeenCalledWith("jev-mini");
    expect(trigger).toHaveTextContent("jev-mini");
  });

  it("does not select disabled items", async () => {
    const user = userEvent.setup();
    const onValueChange = renderSelect();
    screen.getByRole("combobox").focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("listbox");
    const disabled = screen.getByRole("option", { name: /gpt-5-mini/ });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    await user.click(disabled);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it("inherits id, invalid and description from FieldRow", () => {
    render(
      <FieldRow label="Model" error="Required" hint="Pick one">
        <Select>
          <SelectItem value="a">A</SelectItem>
        </Select>
      </FieldRow>,
    );
    const trigger = screen.getByRole("combobox", { name: "Model" });
    expect(trigger).toHaveAttribute("aria-invalid", "true");
    const described = trigger.getAttribute("aria-describedby") ?? "";
    expect(described.split(" ")).toHaveLength(2);
    expect(screen.getByRole("alert")).toHaveTextContent("Required");
  });
});
