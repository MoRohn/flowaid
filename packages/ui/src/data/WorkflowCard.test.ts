import { describe, expect, it } from "vitest";
import { environmentAbbreviation } from "./WorkflowCard";

describe("environmentAbbreviation", () => {
  it("uses the familiar short names", () => {
    expect(environmentAbbreviation("Production")).toBe("prod");
    expect(environmentAbbreviation("staging")).toBe("stg");
    expect(environmentAbbreviation("Development")).toBe("dev");
  });

  it("keeps short names whole and cuts long unknown ones to three letters", () => {
    expect(environmentAbbreviation("qa")).toBe("qa");
    expect(environmentAbbreviation("demo")).toBe("demo");
    expect(environmentAbbreviation("Sandbox")).toBe("san");
  });
});
