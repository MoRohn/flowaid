#!/usr/bin/env node
/** The `flowaid` executable. */
import { nodeIO } from "./io.js";
import { runCli } from "./program.js";

process.exitCode = await runCli(process.argv.slice(2), nodeIO());
