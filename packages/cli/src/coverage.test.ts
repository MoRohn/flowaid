import type { Command } from "commander";
import { describe, expect, it } from "vitest";
import { OPERATIONS } from "./generated/operations.js";
import { commandKey } from "./generatedCommands.js";
import { HAND_WRITTEN, createProgram } from "./program.js";
import { fakeIo } from "./test/fakeIo.js";

const program = createProgram(fakeIo().io);
const sub = (c: Command, name: string) => c.commands.find((x) => x.name() === name);

/** The command tree as text: one line per command with its arguments and flags. */
function tree(c: Command, prefix = ""): string[] {
  return c.commands
    .map((x) => x)
    .sort((a, b) => a.name().localeCompare(b.name()))
    .flatMap((x) => {
      const path = `${prefix}${x.name()}`;
      const args = x.registeredArguments.map((a) =>
        a.required ? `<${a.name()}>` : `[${a.name()}]`,
      );
      const flags = x.options.map((o) => o.long ?? o.short ?? "");
      const line = [path, ...args, ...(flags.length ? [`{${flags.join(" ")}}`] : [])].join(" ");
      return x.commands.length ? [line, ...tree(x, `${path} `)] : [line];
    });
}

describe("generated CLI", () => {
  it("covers 100 % of the OpenAPI operations with a command (generated or hand-written)", () => {
    const missing = OPERATIONS.filter((op) => {
      const noun = sub(program, op.noun);
      return !noun || !sub(noun, op.verb);
    }).map(commandKey);
    expect(missing).toEqual([]);
    expect(OPERATIONS.length).toBeGreaterThanOrEqual(130);
  });

  it("hand-written commands replace only verbs that exist", () => {
    const keys = new Set(OPERATIONS.map(commandKey));
    for (const key of HAND_WRITTEN) expect(keys.has(key)).toBe(true);
  });

  it("maps positional path parameters to arguments and the rest to flags", () => {
    const deploy = sub(sub(program, "deployment") as Command, "deploy") as Command;
    expect(deploy.registeredArguments.map((a) => a.name())).toEqual(["id", "environmentId"]);
    expect(deploy.options.map((o) => o.long)).toEqual(
      expect.arrayContaining(["--version-id", "--variable-overrides", "--body", "--out"]),
    );
    expect(sub(program, "workflows")).toBeUndefined(); // an alias, not a second command
    expect(sub(program, "workflow")?.aliases()).toEqual(["workflows"]);
  });

  it("matches the command tree snapshot", () => {
    expect(tree(program).join("\n")).toMatchSnapshot();
  });

  it("matches the root help snapshot", () => {
    program.configureHelp({ helpWidth: 100 });
    expect(program.helpInformation()).toMatchSnapshot();
  });
});
