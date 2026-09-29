import { describe, expect, it } from "vitest";
import { templateRefs } from "./NodeInspector";

describe("templateRefs", () => {
  it("offers every node output as the compiler writes it: <node id>.<port>", () => {
    const refs = templateRefs({
      inputs: [],
      variables: [],
      nodes: [
        {
          id: "start",
          name: "Input",
          outputs: [
            { id: "message", label: "message", type: "string", schema: { type: "string" } },
          ],
        },
      ],
    });
    expect(refs).toEqual([
      { ref: { kind: "port", node: "start", port: "message" }, schema: { type: "string" } },
    ]);
  });
});
