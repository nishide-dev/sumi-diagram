/**
 * Generates `schema/figure.v1.schema.json` (JSON Schema 2020-12) from the Zod
 * Figure Schema. With `--check`, fails instead if the committed file is stale.
 */

import { z } from "zod";
import { FigureDocumentSchema } from "../src/core/figure/schema";

const output = `${import.meta.dir}/../schema/figure.v1.schema.json`;
const schema = z.toJSONSchema(FigureDocumentSchema, {
  target: "draft-2020-12",
  io: "input",
  unrepresentable: "throw",
});
const json = `${JSON.stringify(schema, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const file = Bun.file(output);
  const current = (await file.exists()) ? await file.text() : "";
  if (current !== json) {
    console.error("schema/figure.v1.schema.json is out of date. Run `bun run schema:gen`.");
    process.exit(1);
  }
  console.log("schema/figure.v1.schema.json is up to date.");
} else {
  await Bun.write(output, json);
  console.log("Wrote schema/figure.v1.schema.json.");
}
