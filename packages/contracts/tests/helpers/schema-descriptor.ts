/**
 * Schema descriptor utility for snapshot testing Zod schemas.
 *
 * Recursively extracts a JSON-serializable description of any Zod schema,
 * capturing type structure, constraints, and enum values. Changes to schema
 * structure will cause snapshot tests to fail, forcing explicit review.
 */

import { z } from "zod";

export interface SchemaDescription {
  type: string;
  [key: string]: unknown;
}

/**
 * Extract a deterministic, JSON-serializable description of a Zod schema.
 *
 * This captures the structural shape of the schema without runtime behavior,
 * allowing snapshot tests to detect breaking changes.
 */
export function describeSchema(schema: z.ZodTypeAny): SchemaDescription {
  const def = schema._def;
  const typeName: string = def.typeName ?? "Unknown";

  switch (typeName) {
    case "ZodString": {
      const checks = (def.checks ?? []).map((c: { kind: string }) => c.kind);
      return { type: "string", ...(checks.length > 0 ? { checks } : {}) };
    }
    case "ZodNumber": {
      const checks = (def.checks ?? []).map((c: { kind: string }) => c.kind);
      return { type: "number", ...(checks.length > 0 ? { checks } : {}) };
    }
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodBigInt":
      return { type: "bigint" };
    case "ZodDate":
      return { type: "date" };
    case "ZodUndefined":
      return { type: "undefined" };
    case "ZodNull":
      return { type: "null" };
    case "ZodAny":
      return { type: "any" };
    case "ZodUnknown":
      return { type: "unknown" };
    case "ZodNever":
      return { type: "never" };
    case "ZodVoid":
      return { type: "void" };
    case "ZodLiteral":
      return { type: "literal", value: def.value };

    case "ZodEnum":
      return { type: "enum", values: [...def.values].sort() };

    case "ZodNativeEnum":
      return {
        type: "nativeEnum",
        values: Object.values(def.values as Record<string, string | number>)
          .filter((v): v is string => typeof v === "string")
          .sort(),
      };

    case "ZodObject": {
      const shape: Record<string, SchemaDescription> = {};
      const rawShape = def.shape();
      for (const key of Object.keys(rawShape).sort()) {
        shape[key] = describeSchema(rawShape[key]);
      }
      return { type: "object", shape };
    }

    case "ZodArray":
      return { type: "array", element: describeSchema(def.type) };

    case "ZodTuple": {
      const items = (def.items ?? []).map((item: z.ZodTypeAny) =>
        describeSchema(item),
      );
      return { type: "tuple", items };
    }

    case "ZodUnion": {
      const options = (def.options ?? []).map((opt: z.ZodTypeAny) =>
        describeSchema(opt),
      );
      return { type: "union", options };
    }

    case "ZodDiscriminatedUnion": {
      const options = [...(def.options?.values?.() ?? def.options ?? [])].map(
        (opt: z.ZodTypeAny) => describeSchema(opt),
      );
      return {
        type: "discriminatedUnion",
        discriminator: def.discriminator,
        options,
      };
    }

    case "ZodIntersection":
      return {
        type: "intersection",
        left: describeSchema(def.left),
        right: describeSchema(def.right),
      };

    case "ZodRecord":
      return {
        type: "record",
        keyType: describeSchema(def.keyType),
        valueType: describeSchema(def.valueType),
      };

    case "ZodMap":
      return {
        type: "map",
        keyType: describeSchema(def.keyType),
        valueType: describeSchema(def.valueType),
      };

    case "ZodSet":
      return { type: "set", valueType: describeSchema(def.valueType) };

    case "ZodOptional":
      return { type: "optional", inner: describeSchema(def.innerType) };

    case "ZodNullable":
      return { type: "nullable", inner: describeSchema(def.innerType) };

    case "ZodDefault":
      return { type: "default", inner: describeSchema(def.innerType) };

    case "ZodCatch":
      return { type: "catch", inner: describeSchema(def.innerType) };

    case "ZodBranded":
      return { type: "branded", inner: describeSchema(def.type) };

    case "ZodPipeline":
      return {
        type: "pipeline",
        in: describeSchema(def.in),
        out: describeSchema(def.out),
      };

    case "ZodLazy":
      return { type: "lazy" };

    case "ZodEffects":
      return {
        type: "effects",
        effect: def.effect?.type ?? "unknown",
        inner: describeSchema(def.schema),
      };

    case "ZodPromise":
      return { type: "promise", inner: describeSchema(def.type) };

    case "ZodFunction":
      return { type: "function" };

    default:
      return { type: typeName };
  }
}

/**
 * Validate that a schema is a ZodType instance.
 */
export function isZodSchema(value: unknown): value is z.ZodTypeAny {
  return value instanceof z.ZodType;
}
