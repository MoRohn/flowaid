import { describe, expect, it } from "vitest";
import { chosenMethod, emptyNewWorkflow, startOptions } from "./startOptions";

describe("start options", () => {
  it("offers only what the server has turned on", () => {
    expect(startOptions({ aiBuilder: true, templates: true }).map((o) => o.id)).toEqual([
      "describe",
      "blank",
      "template",
      "import",
    ]);
    expect(startOptions({ aiBuilder: false, templates: false }).map((o) => o.id)).toEqual([
      "blank",
      "import",
    ]);
  });

  it("treats a kept choice the server no longer offers as not chosen", () => {
    const offered = startOptions({ aiBuilder: false, templates: true });
    expect(chosenMethod({ ...emptyNewWorkflow(), method: "describe" }, offered)).toBeUndefined();
    expect(chosenMethod({ ...emptyNewWorkflow(), method: "template" }, offered)).toBe("template");
    expect(chosenMethod(emptyNewWorkflow(), offered)).toBeUndefined();
  });
});
