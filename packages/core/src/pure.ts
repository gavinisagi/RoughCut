/**
 * Node-free subset of the engine, safe to import in browser contexts
 * (the Electron renderer runs detection/planning locally for instant
 * parameter feedback). Keep this file free of node:* imports.
 */
export * from "./types.js";
export * from "./detect.js";
export * from "./plan.js";
