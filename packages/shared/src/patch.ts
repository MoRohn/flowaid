/**
 * RFC 6902 JSON Patch, applied immutably: the input document is never modified and the result
 * shares no mutable structure with it. Pointers follow RFC 6901 (`~1` is `/`, `~0` is `~`); `-`
 * appends to an array. Any failure (a missing parent, an out-of-range index, a failing `test`)
 * throws `JsonPatchError` and nothing is applied.
 */
import { cloneJson, deepEqual, type JsonValue } from "./json.js";

export type JsonPatchOperation =
  | { op: "add"; path: string; value: JsonValue }
  | { op: "remove"; path: string }
  | { op: "replace"; path: string; value: JsonValue }
  | { op: "move"; from: string; path: string }
  | { op: "copy"; from: string; path: string }
  | { op: "test"; path: string; value: JsonValue };

export class JsonPatchError extends Error {
  constructor(
    message: string,
    readonly index: number,
  ) {
    super(message);
    this.name = "JsonPatchError";
  }
}

function tokens(pointer: string): string[] {
  if (pointer === "") return [];
  if (!pointer.startsWith("/")) throw new Error(`invalid JSON pointer ${JSON.stringify(pointer)}`);
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

type Container = JsonValue[] | { [key: string]: JsonValue };

function isContainer(v: JsonValue | undefined): v is Container {
  return typeof v === "object" && v !== null;
}

function arrayIndex(token: string, length: number, allowEnd: boolean): number {
  if (token === "-" && allowEnd) return length;
  if (!/^(0|[1-9]\d*)$/.test(token)) throw new Error(`invalid array index ${token}`);
  const i = Number(token);
  if (i > length || (!allowEnd && i === length))
    throw new Error(`array index ${token} out of range`);
  return i;
}

/** The container that holds `pointer`'s last token, and that token. */
function parentOf(doc: JsonValue, pointer: string): { parent: Container; key: string } {
  const path = tokens(pointer);
  const key = path.pop();
  if (key === undefined) throw new Error("the root has no parent");
  let node: JsonValue | undefined = doc;
  for (const t of path) {
    if (Array.isArray(node)) node = node[arrayIndex(t, node.length, false)];
    else if (isContainer(node) && Object.hasOwn(node, t)) node = node[t];
    else throw new Error(`path ${pointer} does not exist`);
  }
  if (!isContainer(node)) throw new Error(`path ${pointer} does not exist`);
  return { parent: node, key };
}

/** The value at `pointer`, or undefined when the path does not exist. */
export function getPointer(doc: JsonValue, pointer: string): JsonValue | undefined {
  let node: JsonValue | undefined = doc;
  for (const t of tokens(pointer)) {
    if (Array.isArray(node)) {
      if (!/^(0|[1-9]\d*)$/.test(t)) return undefined;
      node = node[Number(t)];
    } else if (isContainer(node) && Object.hasOwn(node, t)) node = node[t];
    else return undefined;
  }
  return node;
}

function remove(doc: JsonValue, pointer: string): JsonValue {
  const { parent, key } = parentOf(doc, pointer);
  if (Array.isArray(parent)) {
    const [removed] = parent.splice(arrayIndex(key, parent.length, false), 1);
    return removed as JsonValue;
  }
  if (!Object.hasOwn(parent, key)) throw new Error(`path ${pointer} does not exist`);
  const removed = parent[key] as JsonValue;
  delete parent[key];
  return removed;
}

function add(doc: JsonValue, pointer: string, value: JsonValue): JsonValue {
  if (pointer === "") return value;
  const { parent, key } = parentOf(doc, pointer);
  if (Array.isArray(parent)) parent.splice(arrayIndex(key, parent.length, true), 0, value);
  else parent[key] = value;
  return doc;
}

/** Applies `patch` to a copy of `doc` and returns the copy. */
export function applyJsonPatch<T extends JsonValue>(
  doc: T,
  patch: readonly JsonPatchOperation[],
): T {
  let out: JsonValue = cloneJson(doc);
  patch.forEach((op, index) => {
    try {
      switch (op.op) {
        case "add":
          out = add(out, op.path, cloneJson(op.value));
          break;
        case "remove":
          remove(out, op.path);
          break;
        case "replace":
          if (op.path === "") out = cloneJson(op.value);
          else {
            remove(out, op.path);
            out = add(out, op.path, cloneJson(op.value));
          }
          break;
        case "move": {
          if (op.path.startsWith(`${op.from}/`)) throw new Error("cannot move a value into itself");
          out = add(out, op.path, remove(out, op.from));
          break;
        }
        case "copy": {
          const value = getPointer(out, op.from);
          if (value === undefined) throw new Error(`path ${op.from} does not exist`);
          out = add(out, op.path, cloneJson(value));
          break;
        }
        case "test": {
          const value = getPointer(out, op.path);
          if (value === undefined || !deepEqual(value, op.value))
            throw new Error(`test failed at ${op.path}`);
          break;
        }
      }
    } catch (error) {
      throw new JsonPatchError(
        `patch operation ${index} (${op.op} ${op.path}): ${error instanceof Error ? error.message : String(error)}`,
        index,
      );
    }
  });
  return out as T;
}
