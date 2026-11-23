import {
  addDrawing,
  changeDrawing,
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
import { shareTitle } from "./sheets";

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
export function sheetChange(drawing: Drawing, choice: SheetChoice, sheetId?: string | null): Edit {
  const sheet = sheetOf(drawing, sheetId);
  return [
    (d) => {
      const next = changeSheet(d, drawing.id, sheet.id, (s) => {
        const next: DrawingSheet = {
          // First angle and third angle put projected views on opposite sides of their parent.
          ...(choice.standard === s.standard ? s : flipAngle(s)),
          size: choice.size,
          landscape: choice.landscape,
          standard: choice.standard,
          border: choice.border,
          scale: choice.scale ?? s.scale,
          title: choice.title ?? s.title,
        };
        // Rows of dimensions the same as the standard's are left out of the file.
        if (choice.rows) next.rows = choice.rows;
        else delete next.rows;
        return next;
      });
      // The title block is the drawing's: its other sheets take what was typed here (#572).
      const title = choice.title;
      return title ? changeDrawing(next, drawing.id, (x) => (x.sheets.length > 1 ? { ...x, sheets: x.sheets.map((s) => ({ ...s, title })) } : x)) : next;
    },
    "Sheet settings",
  ];
}

/**
 * One title block field typed on the sheet. A blank leaves the field out of the file. Every sheet of a drawing shares
 * its title block, so the others take the change too (#572).
 */
export function titleChange(drawing: Drawing, field: keyof TitleBlock, value: string): Edit {
  return [(d) => changeDrawing(d, drawing.id, (x) => shareTitle(x, field, value)), "Title block"];
}

/** A change to the drawing's sheets: one added, renamed, moved, copied or deleted, or a view moved between two. */
export function drawingEdit(drawing: Drawing, change: (d: Drawing) => Drawing, label: string): Edit {
  return [(d) => changeDrawing(d, drawing.id, change), label];
}

/** The sheet that is open: the one asked for, or the first. */
export const sheetOf = (drawing: Drawing, sheetId?: string | null): DrawingSheet => drawing.sheets.find((s) => s.id === sheetId) ?? drawing.sheets[0]!;

/** The browser's Rename and Delete. */
export function drawingChange(id: string, act: "rename" | "delete", name?: string): Edit {
  return act === "delete" ? [(d) => removeDrawing(d, id), "Delete drawing"] : [(d) => renameDrawing(d, id, name ?? ""), "Rename drawing"];
}

/** A change to the open sheet's views: one placed, moved, edited or deleted. */
export function sheetEdit(drawing: Drawing, change: (s: DrawingSheet) => DrawingSheet, label: string, sheetId?: string | null): Edit {
  return [(d) => changeSheet(d, drawing.id, sheetOf(drawing, sheetId).id, change), label];
}

/** How many decimal places the drawing's dimensions show (0 to 3). */
export function decimalsChange(drawing: Drawing, places: number): Edit {
  const decimals = Math.max(0, Math.min(3, Math.round(places)));
  return [(d) => changeDrawing(d, drawing.id, (x) => (x.decimals === decimals ? x : { ...x, decimals })), "Decimal places"];
}
