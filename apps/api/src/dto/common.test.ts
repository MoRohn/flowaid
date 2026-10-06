import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queryBool } from "./common.js";

describe("queryBool", () => {
  const flag = z.object({ purge: queryBool() });

  it("reads false as false (z.coerce.boolean reads any non-empty string as true)", () => {
    expect(flag.parse({ purge: "false" }).purge).toBe(false);
    expect(flag.parse({ purge: "0" }).purge).toBe(false);
  });

  it("reads true and 1 as true, and defaults when absent", () => {
    expect(flag.parse({ purge: "true" }).purge).toBe(true);
    expect(flag.parse({ purge: "1" }).purge).toBe(true);
    expect(flag.parse({}).purge).toBe(false);
  });

  it("refuses anything else instead of guessing", () => {
    expect(flag.safeParse({ purge: "yes" }).success).toBe(false);
    expect(flag.safeParse({ purge: "" }).success).toBe(false);
  });

  it("is documented as a boolean", () => {
    expect(z.toJSONSchema(queryBool(), { io: "input" })).toMatchObject({
      type: "boolean",
      default: false,
    });
  });
});
