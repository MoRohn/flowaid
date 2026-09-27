/** Output validation against the node's declared schema. */
import Ajv2020Module from "ajv/dist/2020.js";
import { SchemaValidationError, type JsonSchema, type JsonValue } from "@flowaid/workflow-core";

const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ strict: false, allErrors: true, validateFormats: false });

export function validateOutput(schema: JsonSchema | undefined, value: JsonValue): void {
  if (!schema) return;
  const validate = ajv.compile(schema as object);
  if (!validate(value))
    throw new SchemaValidationError(
      "the code's return value does not match the declared output schema",
      (validate.errors ?? []).map((e) => ({
        path: e.instancePath,
        message: e.message ?? e.keyword,
      })),
    );
}
