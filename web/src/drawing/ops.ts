import {
  addDrawing,
  changeSheet,
  removeDrawing,
  renameDrawing,
  standardFor,
  type Drawing,
  type DrawingSheet,
  type TitleBlock,
} from "@bettercad/kernel/drawing";
import type { ModelDoc } from "../state/document";
import { today } from "./layout";
import { flipAngle } from "./projected";
import { rememberSheet, type SheetPick } from "./prefs";
import type { SheetChoice } from "./SheetCard";

/** A change to the model and its name in Undo, as the editor's history takes them. */
type Edit = [(d: ModelDoc) => ModelDoc, string];

/**
 * A new drawing from the set-up card, dated today and signed with the account's name. The page is remembered for the
 * next one; the standard only when it was picked against the page size.
 */
export function makeDrawing(doc: ModelDoc, choice: SheetChoice, author?: string): { doc: ModelDoc; id: string } {
  const pick: SheetPick = { size: choice.size, landscape: choice.landscape, border: choice.border };
  if (choice.standard !== standardFor(choice.size)) pick.standard = choice.standard;
  rememberSheet(pick);
  return addDrawing(doc, { ...pick, standard: choice.standard, author, date: today() });
}

/** Sheet settings' Done: the page, the scale and the title block in one step. */
export function sheetChange(drawing: Drawing, choice: SheetChoice): Edit {
  const sheet = drawing.sheets[0]!;
  return [
    (d) =>
      changeSheet(d, drawing.id, sheet.id, (s) => ({
        // First angle and third angle put projected views on opposite sides of their parent.
        ...(choice.standard === s.standard ? s : flipAngle(s)),
        size: choice.size,
        landscape: choice.landscape,
        standard: choice.standard,
        border: choice.border,
        scale: choice.scale ?? s.scale,
        title: choice.title ?? s.title,
      })),
    "Sheet settings",
  ];
}

/** One title block field typed on the sheet. A blank leaves the field out of the file. */
export function titleChange(drawing: Drawing, field: keyof TitleBlock, value: string): Edit {
  return [
    (d) =>
      changeSheet(d, drawing.id, drawing.sheets[0]!.id, (s) => {
        const title = { ...s.title };
        if (value) title[field] = value;
        else delete title[field];
        return { ...s, title };
      }),
    "Title block",
  ];
}

/** The browser's Rename and Delete. */
export function drawingChange(id: string, act: "rename" | "delete", name?: string): Edit {
  return act === "delete" ? [(d) => removeDrawing(d, id), "Delete drawing"] : [(d) => renameDrawing(d, id, name ?? ""), "Rename drawing"];
}

/** A change to the open sheet's views: one placed, moved, edited or deleted. */
export function sheetEdit(drawing: Drawing, change: (s: DrawingSheet) => DrawingSheet, label: string): Edit {
  return [(d) => changeSheet(d, drawing.id, drawing.sheets[0]!.id, change), label];
}
