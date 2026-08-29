// @valyria/protocol — the typed Core boundary.
//
// ESLint (added in a later increment) forbids importing from ./generated
// outside this package: the rest of the app names wire types through here.

export * from "./capabilities.js";
export * from "./events/registry.js";

// Generated request/response types. Present after `npm run codegen`.
// Re-exported lazily so a fresh checkout typechecks the hand-written modules
// before codegen has run; uncomment once ./generated is committed.
// export type { Request } from "./generated/request.js";
// export type { Response } from "./generated/response.js";
// export { PROTOCOL_VERSION } from "./generated/version.js";

/** Protocol version this package's schemas were vendored at. Mirrors
 *  schemas/version.txt and core.lock.json; the generated copy supersedes this
 *  once codegen has run. */
export const VENDORED_PROTOCOL_VERSION = "1.0.0" as const;
