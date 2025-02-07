import type {
  GraphQLFieldExtensions,
  GraphQLFieldResolver,
  GraphQLScalarLiteralParser,
  GraphQLScalarSerializer,
  GraphQLScalarValueParser,
  GraphQLSchema,
} from "graphql";
import * as graphql from "graphql";

import type {
  EnumValueApplyPlanResolver,
  FieldPlanResolver,
  ScalarPlanResolver,
} from "./interfaces.js";
import type { ExecutableStep } from "./step.js";

const {
  buildASTSchema,
  isEnumType,
  isInputObjectType,
  isInterfaceType,
  isObjectType,
  isScalarType,
  isUnionType,
  parse,
} = graphql;

// TYPES: improve the types here!
/**
 * When defining a field with `typeDefs/plans` you can declare the field plan
 * directly, or you can define a configuration object that accepts the plan and
 * more.
 */
export type FieldPlans =
  | FieldPlanResolver<any, any, any>
  | {
      plan?: FieldPlanResolver<any, any, any>;
      subscribePlan?: FieldPlanResolver<any, any, any>;
      resolve?: GraphQLFieldResolver<any, any>;
      subscribe?: GraphQLFieldResolver<any, any>;
      args?: {
        [argName: string]: Grafast.ArgumentExtensions;
      };
    };

/**
 * The plans/config for each field of a GraphQL object type.
 */
export type ObjectPlans = {
  __assertStep?:
    | ((step: ExecutableStep) => asserts step is ExecutableStep)
    | { new (...args: any[]): ExecutableStep };
} & {
  [fieldName: string]: FieldPlans;
};

/**
 * The plans for each field of a GraphQL input object type.
 */
export type InputObjectPlans = {
  [fieldName: string]: Grafast.InputFieldExtensions;
};

/**
 * The plan config for an interface or union type.
 */
export type InterfaceOrUnionPlans = {
  __resolveType?: (o: unknown) => string;
};

/**
 * The config for a GraphQL scalar type.
 */
export type ScalarPlans = {
  serialize?: GraphQLScalarSerializer<any>;
  parseValue?: GraphQLScalarValueParser<any>;
  parseLiteral?: GraphQLScalarLiteralParser<any>;
  plan?: ScalarPlanResolver<any, any>;
};

/**
 * The values/configs for the entries in a GraphQL enum type.
 */
export type EnumPlans = {
  // The internal value for the enum
  [enumValueName: string]:
    | EnumValueApplyPlanResolver
    | string
    | number
    | boolean
    | {
        value?: unknown;
        applyPlan?: EnumValueApplyPlanResolver;
      };
};

/**
 * A map from GraphQL named type to the config for that type.
 */
export interface GrafastPlans {
  [typeName: string]:
    | ObjectPlans
    | InputObjectPlans
    | InterfaceOrUnionPlans
    | ScalarPlans
    | EnumPlans;
}

/**
 * Takes a GraphQL schema definition in Interface Definition Language (IDL/SDL)
 * syntax and configs for the types in it and returns a GraphQL schema.
 */
export function makeGrafastSchema(details: {
  typeDefs: string;
  plans: GrafastPlans;
  enableDeferStream?: boolean;
}): GraphQLSchema {
  const { typeDefs, plans, enableDeferStream = false } = details;

  const schema = buildASTSchema(parse(typeDefs), {
    enableDeferStream,
  });

  // Now add the plans/etc to the schema
  for (const [typeName, spec] of Object.entries(plans)) {
    const type = schema.getType(typeName);
    if (!type) {
      console.warn(
        `'plans' specified configuration for type '${typeName}', but that type was not present in the schema`,
      );
      continue;
    }
    if (isObjectType(type)) {
      if (typeof spec !== "object" || !spec) {
        throw new Error(`Invalid object config for '${typeName}'`);
      }

      const objSpec = spec as ObjectPlans;
      const fields = type.getFields();
      for (const [fieldName, fieldSpec] of Object.entries(objSpec)) {
        if (fieldName === "__assertStep") {
          (
            type.extensions as graphql.GraphQLObjectTypeExtensions<any, any>
          ).grafast = { assertStep: fieldSpec as any };
          continue;
        } else if (fieldName.startsWith("__")) {
          throw new Error(
            `Unsupported field name '${fieldName}'; perhaps you meant '__assertStep'?`,
          );
        }

        const field = fields[fieldName];
        if (!field) {
          console.warn(
            `'plans' specified configuration for object type '${typeName}' field '${fieldName}', but that field was not present in the type`,
          );
          continue;
        }

        if (typeof fieldSpec === "function") {
          // it's a plan
          (field.extensions as any).grafast = {
            plan: fieldSpec,
          };
        } else {
          // it's a spec
          const grafastExtensions: GraphQLFieldExtensions<any, any>["grafast"] =
            Object.create(null);
          (field.extensions as any).grafast = grafastExtensions;
          if (typeof fieldSpec.resolve === "function") {
            field.resolve = fieldSpec.resolve;
          }
          if (typeof fieldSpec.subscribe === "function") {
            field.subscribe = fieldSpec.subscribe;
          }
          if (typeof fieldSpec.plan === "function") {
            grafastExtensions!.plan = fieldSpec.plan;
          }
          if (typeof fieldSpec.subscribePlan === "function") {
            grafastExtensions!.subscribePlan = fieldSpec.subscribePlan;
          }

          if (typeof fieldSpec.args === "object" && fieldSpec.args != null) {
            for (const [argName, argSpec] of Object.entries(fieldSpec.args)) {
              const arg = field.args.find((arg) => arg.name === argName);
              if (!arg) {
                console.warn(
                  `'plans' specified configuration for object type '${typeName}' field '${fieldName}' arg '${argName}', but that arg was not present in the type`,
                );
                continue;
              }
              if (typeof argSpec === "function") {
                // Invalid
                throw new Error(
                  `Invalid configuration for plans.${typeName}.${fieldName}.args.${argName} - saw a function, but expected an object with 'inputPlan' (optional) and 'applyPlan' (optional) plans`,
                );
              } else {
                const grafastExtensions: Grafast.ArgumentExtensions =
                  Object.create(null);
                (arg.extensions as any).grafast = grafastExtensions;
                Object.assign(grafastExtensions, argSpec);
              }
            }
          }
        }
      }
    } else if (isInputObjectType(type)) {
      if (typeof spec !== "object" || !spec) {
        throw new Error(`Invalid input object config for '${typeName}'`);
      }

      const inputSpec = spec as InputObjectPlans;

      const fields = type.getFields();

      for (const [fieldName, fieldSpec] of Object.entries(inputSpec)) {
        const field = fields[fieldName];
        if (!field) {
          console.warn(
            `'plans' specified configuration for input object type '${typeName}' field '${fieldName}', but that field was not present in the type`,
          );
          continue;
        }
        if (typeof fieldSpec === "function") {
          throw new Error(
            `Expected input object type '${typeName}' field '${fieldName}' to be an object, but found a function. We don't know if this should be the 'inputPlan' or 'applyPlan' - please supply an object.`,
          );
        } else {
          // it's a spec
          const grafastExtensions: Grafast.InputFieldExtensions =
            Object.create(null);
          (field.extensions as any).grafast = grafastExtensions;
          Object.assign(grafastExtensions, fieldSpec);
        }
      }
    } else if (isInterfaceType(type) || isUnionType(type)) {
      if (typeof spec !== "object" || !spec) {
        throw new Error(`Invalid interface/union config for '${typeName}'`);
      }
      const polySpec = spec as InterfaceOrUnionPlans;
      if (polySpec.__resolveType) {
        type.resolveType = polySpec.__resolveType;
      }
    } else if (isScalarType(type)) {
      if (typeof spec !== "object" || !spec) {
        throw new Error(`Invalid scalar config for '${typeName}'`);
      }
      const scalarSpec = spec as ScalarPlans;
      if (typeof scalarSpec.serialize === "function") {
        type.serialize = scalarSpec.serialize;
      }
      if (typeof scalarSpec.parseValue === "function") {
        type.parseValue = scalarSpec.parseValue;
      }
      if (typeof scalarSpec.parseLiteral === "function") {
        type.parseLiteral = scalarSpec.parseLiteral;
      }
      if (typeof scalarSpec.plan === "function") {
        (type.extensions as any).grafast = { plan: scalarSpec.plan };
      }
    } else if (isEnumType(type)) {
      if (typeof spec !== "object" || !spec) {
        throw new Error(`Invalid enum config for '${typeName}'`);
      }
      const enumValues = type.getValues();
      for (const [enumValueName, enumValueSpec] of Object.entries(
        spec as EnumPlans,
      )) {
        const enumValue = enumValues.find((val) => val.name === enumValueName);
        if (!enumValue) {
          console.warn(
            `'plans' specified configuration for enum type '${typeName}' value '${enumValueName}', but that value was not present in the type`,
          );
          continue;
        }
        if (typeof enumValueSpec === "function") {
          // It's a plan
          (enumValue.extensions as any).grafast = {
            applyPlan: enumValueSpec,
          } as Grafast.EnumValueExtensions;
        } else if (typeof enumValueSpec === "object" && enumValueSpec != null) {
          // It's a full spec
          if (enumValueSpec.applyPlan) {
            (enumValue.extensions as any).grafast = {
              applyPlan: enumValueSpec.applyPlan,
            } as Grafast.EnumValueExtensions;
          }
          if ("value" in enumValueSpec) {
            enumValue.value = enumValueSpec.value;
          }
        } else {
          // It must be the value
          enumValue.value = enumValueSpec;
        }
      }
    } else {
      const never: never = type;
      console.error(`Unhandled type ${never}`);
    }
  }
  return schema;
}
