import type { ElectronicsDesign } from "@bettercad/electronics";
import { BOARD_RULES, waiveBoard } from "@bettercad/electronics/drc";
import { presetOf } from "@bettercad/electronics/pcb/rules";
import { Button, PanelNote } from "@bettercad/ui";
import type { EEdit } from "./actions";
import { useBoardCheck } from "./boardCheck";
import { ChecksPanel } from "./Checks";
import { eui } from "./ui";

/**
 * The board's rules check (#644): shorts, gaps, unrouted connections and what a board house could not make. It reads
 * the board each time it changes, so the list is always the board as it is now. The measuring is done in a worker, so
 * a big board does not hold the page up; the last list stays up while a newer one is found.
 */
export default function BoardChecks(p: { design: ElectronicsDesign; edit: EEdit; readOnly?: boolean; onClose: () => void }) {
  const { results } = useBoardCheck(p.design);
  const rules = p.design.board?.rules;
  const preset = rules && presetOf(rules);
  return (
    <ChecksPanel
      {...p}
      title="Board check"
      results={results ?? []}
      rules={BOARD_RULES}
      clean={results ? "No problems found. The board is ready to make." : "Checking the board."}
      onWaive={waiveBoard}
    >
      <PanelNote>
        Checked against {preset ? preset.name : "your own rules"}.{" "}
        <Button
          size="dense"
          variant="secondary"
          label="Board rules"
          title="Choose a board house or set the numbers"
          onClick={() => eui.set({ card: "board" })}
        />
      </PanelNote>
    </ChecksPanel>
  );
}
