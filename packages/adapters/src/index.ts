/**
 * @sdap/adapters: Model adapters (Jev, Gemini/Argon, Claude, OpenAI-compatible, local, mock) behind one interface.
 * Owned by workstream WS4.
 */

// Core adapters
export * from "./adapters/jev.js";
export * from "./adapters/rules.js";
export * from "./adapters/gemini.js";
export * from "./adapters/claude.js";
export * from "./adapters/openai_compat.js";
export * from "./adapters/local.js";
export * from "./adapters/mock.js";

// Registry & Configuration
export * from "./registry.js";
export * from "./types.js";

// Pricing & HTTP utilities
export * from "./pricing.js";
export * from "./http.js";

export const PACKAGE_NAME = "@sdap/adapters";
