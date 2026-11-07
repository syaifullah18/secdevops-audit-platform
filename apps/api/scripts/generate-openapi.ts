import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getOpenApiSpec } from "../src/openapi.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const outputPath = join(__dirname, "..", "openapi.json");

const spec = getOpenApiSpec();
writeFileSync(outputPath, JSON.stringify(spec, null, 2) + "\n");
console.log(`OpenAPI document generated at ${outputPath}`);
