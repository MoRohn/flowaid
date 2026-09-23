/**
 * `defineNode` and `definePackage` (CONTRACTS.ts §16): identity functions that give node and
 * package authors full type inference from their Zod schemas.
 */
import type { z } from "zod";
import type { NodeDefinition, NodePackage } from "./types.js";

export function defineNode<C extends z.ZodObject, I extends z.ZodObject, O extends z.ZodObject>(
  def: NodeDefinition<C, I, O>,
): NodeDefinition<C, I, O> {
  return def;
}

export function definePackage(pkg: NodePackage): NodePackage {
  return pkg;
}
