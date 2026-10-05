/**
 * A step's config as the builder saves it. The config form gives every optional setting a slot so
 * it can show the defaults; saving those slots would turn settings on that nobody chose (a Mock's
 * `fail`) or leave stubs that fail their own required fields (a Boolean's `criteria: {}`), so new
 * steps and form edits both go through `pruneUnset`.
 */
import type { JsonSchema } from "@flowaid/workflow-core";
import { pruneUnset, withDefaults } from "@flowaid/ui/forms";

/** A new step's config: the schema's defaults, without stubs for optional settings. */
export function newStepConfig(schema: JsonSchema): Record<string, unknown> {
  return pruneUnset(schema as never, withDefaults(schema as never, {}));
}

/** What the config form produced, as the step saves it. */
export function savedStepConfig(
  schema: JsonSchema,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return pruneUnset(schema as never, values);
}
