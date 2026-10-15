#!/usr/bin/env bun
import { createProgram } from "./program";

await createProgram().parseAsync(process.argv);
