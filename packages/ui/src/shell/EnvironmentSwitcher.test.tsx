import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { installDomStubs } from "@/primitives/testStubs";
import type { EnvironmentView } from "@/types";
import {
  EnvironmentSwitcher,
  environmentLabel,
  environmentShortLabel,
} from "./EnvironmentSwitcher";

beforeAll(() => installDomStubs());
afterEach(cleanup);

const ENVS: EnvironmentView[] = [
  { id: "env_dev", name: "Development", protected: false },
  { id: "env_stg", name: "Staging", protected: false },
  { id: "env_prod", name: "Production", protected: true },
];

describe("EnvironmentSwitcher", () => {
  it("labels environments from the workspace data", () => {
    expect(environmentLabel(ENVS, "env_dev")).toBe("Development");
    expect(environmentLabel(ENVS, "env_prod", true)).toBe("Prod");
    expect(environmentLabel(ENVS, "env_missing")).toBe("env_missing");
    expect(environmentShortLabel("Staging")).toBe("Staging");
    expect(environmentShortLabel("Development")).toBe("Dev");
    expect(environmentShortLabel("Production")).toBe("Prod");
    expect(environmentShortLabel("EU production")).toBe("EU p");
  });

  it("switches between unprotected environments without asking", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EnvironmentSwitcher environments={ENVS} value="env_dev" onChange={onChange} />);
    expect(screen.getByRole("radio", { name: "Development" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await user.click(screen.getByRole("radio", { name: "Staging" }));
    expect(onChange).toHaveBeenCalledWith("env_stg");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before switching to a protected environment and only changes on confirm", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<EnvironmentSwitcher environments={ENVS} value="env_stg" onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Production" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Switch to Production?");
    expect(onChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: "Production" }));
    await user.click(await screen.findByRole("button", { name: "Switch to Production" }));
    expect(onChange).toHaveBeenCalledWith("env_prod");
  });

  it("switches to a protected environment directly when confirmation is off", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EnvironmentSwitcher
        environments={ENVS}
        value="env_stg"
        onChange={onChange}
        confirmProtected={false}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "Production" }));
    expect(onChange).toHaveBeenCalledWith("env_prod");
  });
});
