import { zip } from "@bettercad/kernel/zip";
import type { Table } from "@bettercad/electronics/fab/pack";

/**
 * A table as an .xlsx workbook with one sheet (#658, #659): the least a spreadsheet needs, which is five small XML
 * files in a zip. Text is kept as text, so a part number like 0805 or 1E3 is never read as a number.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A1, B1 … Z1, AA1. */
const ref = (col: number, row: number) => {
  let name = "";
  for (let n = col; n >= 0; n = Math.floor(n / 26) - 1) name = String.fromCharCode(65 + (n % 26)) + name;
  return `${name}${row + 1}`;
};

export function xlsx(table: Table, sheetName = "Sheet1"): Uint8Array {
  const rows = table
    .map(
      (row, r) =>
        `<row r="${r + 1}">${row
          .map((v, c) =>
            typeof v === "number"
              ? `<c r="${ref(c, r)}"><v>${v}</v></c>`
              : `<c r="${ref(c, r)}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`,
          )
          .join("")}</row>`,
    )
    .join("");
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const ns = "http://schemas.openxmlformats.org";
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      `${head}<Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `${head}<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      "xl/workbook.xml",
      `${head}<workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ],
    [
      "xl/_rels/workbook.xml.rels",
      `${head}<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    ],
    ["xl/worksheets/sheet1.xml", `${head}<worksheet xmlns="${ns}/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`],
  ];
  const enc = new TextEncoder();
  return zip(files.map(([name, text]) => ({ name, data: enc.encode(text) })));
}
