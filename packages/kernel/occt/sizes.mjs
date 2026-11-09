#!/usr/bin/env node
/** Prints a WASM file's size raw, gzipped and with Brotli, against #43's targets, as a Markdown table. */
import { readFileSync } from "node:fs";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const file = process.argv[2];
const data = readFileSync(file);
const mb = (n) => (n / 1024 / 1024).toFixed(1);
const br = brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 9 } }).length;
const rows = [
  ["Raw", data.length, 12],
  ["Gzip", gzipSync(data, { level: 9 }).length, null],
  ["Brotli", br, 3.5],
];
console.log(`## ${file.split("/").pop()}\n\n| | MB | Target |\n| --- | ---: | ---: |`);
for (const [what, n, target] of rows) console.log(`| ${what} | ${mb(n)} | ${target ?? ""} |`);
