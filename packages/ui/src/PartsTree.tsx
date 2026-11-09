import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { Icon } from "./Icon";
import { IconButton } from "./Button";
import type { IconName } from "./icons";
import { cx } from "./cx";
import { clickSelect } from "./selection";
import { longPress } from "./Menu";

export type RowToggle = "hidden" | "ghost" | "highlight" | "active";

export interface TreeItem {
  id: string;
  name: string;
  icon?: IconName;
  /** The item this one sits under (a body under its sketch, a feature under its body). */
  parentId?: string | null;
  hidden?: boolean;
  ghost?: boolean;
  highlight?: boolean;
  /** The active component (#171): its radio is on. */
  active?: boolean;
  /** States inherited from the parent show at 55%. */
  inherited?: Partial<Record<RowToggle, boolean>>;
  /** A problem with this item (a failed feature): a mark after the name, the message in its tooltip. */
  warning?: string;
  /** Muted text after the name, such as a folder's count. */
  note?: string;
  /** Row buttons for this item, in place of the tree's `toggles`. */
  toggles?: RowToggle[];
  /** false: the row can't be dragged (a folder, a plane). */
  drag?: boolean;
  /** false: the row can't be renamed. */
  rename?: boolean;
  /** Starts folded, until the person opens it. */
  folded?: boolean;
  /** What the row is (body, sketch, plane, folder), as `data-kind` for styling. */
  kind?: string;
  /** It can be dragged onto a row that takes it (`into`), with `onDropInto`. */
  move?: boolean;
  /** Rows marked `move` can be dropped onto it: a component (#334). */
  into?: boolean;
}

export interface PartsTreeProps {
  label: string;
  /** A flat list in display order; children follow their parent. */
  items: TreeItem[];
  selection: string[];
  onSelect: (ids: string[]) => void;
  onRename?: (id: string, name: string) => void;
  onToggle?: (id: string, what: RowToggle) => void;
  /** Drag to reorder among siblings: move `id` before `beforeId` (null for the end). */
  onReorder?: (id: string, beforeId: string | null) => void;
  /** Drag a `move` row onto an `into` row. */
  onDropInto?: (id: string, into: string) => void;
  onContextMenu?: (id: string, at: { x: number; y: number }) => void;
  /** Row buttons to show, in order. */
  toggles?: RowToggle[];
  empty?: ReactNode;
  /** Controls which row is being renamed inline (F2 from a menu or the palette). Leave out to let the tree own it. */
  renameId?: string | null;
  onRenameIdChange?: (id: string | null) => void;
  /** Double-click: opens the row to edit it (a section analysis), returning true, in place of renaming it. */
  onOpen?: (id: string) => boolean;
}

const TOGGLE: Record<RowToggle, { on: IconName; off: IconName; onTitle: string; offTitle: string }> = {
  hidden: { on: "eyeOff", off: "eye", onTitle: "Show", offTitle: "Hide" },
  ghost: { on: "ghost", off: "ghost", onTitle: "Stop showing as a reference", offTitle: "Show as a reference" },
  highlight: { on: "highlight", off: "highlight", onTitle: "Remove the highlight", offTitle: "Highlight" },
  active: { on: "radioOn", off: "radioOff", onTitle: "Working in", offTitle: "Activate" },
};

/** Depth of each item from its parent chain. */
export function depths(items: TreeItem[]): Map<string, number> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Map<string, number>();
  const depthOf = (i: TreeItem, guard = 0): number => {
    if (out.has(i.id)) return out.get(i.id)!;
    const p = i.parentId ? byId.get(i.parentId) : undefined;
    const d = p && guard < 64 ? depthOf(p, guard + 1) + 1 : 0;
    out.set(i.id, d);
    return d;
  };
  items.forEach((i) => depthOf(i));
  return out;
}

/**
 * The parts tree. Click selects, Ctrl/Cmd-click adds, Shift-click selects a range. Up and Down move, Left and Right
 * fold, Enter selects, F2 renames, Space adds to the selection. Rows can be dragged to reorder among siblings, or
 * onto a row that takes them.
 */
export function PartsTree({
  label,
  items,
  selection,
  onSelect,
  onRename,
  onToggle,
  onReorder,
  onDropInto,
  onContextMenu,
  toggles = ["hidden"],
  empty,
  renameId,
  onRenameIdChange,
  onOpen,
}: PartsTreeProps) {
  // Folds the person chose, by id; rows they haven't touched follow their `folded`.
  const [folds, setFolds] = useState<Map<string, boolean>>(new Map());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [localRenaming, setLocalRenaming] = useState<string | null>(null);
  const renaming = renameId !== undefined ? renameId : localRenaming;
  const setRenaming = onRenameIdChange ?? setLocalRenaming;
  const [dropBefore, setDropBefore] = useState<string | null | undefined>(undefined);
  const [dropInto, setDropInto] = useState<string | null>(null);
  const anchor = useRef<string | null>(null);
  const dragId = useRef<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const depth = useMemo(() => depths(items), [items]);
  const hasChildren = useMemo(() => new Set(items.filter((i) => i.parentId).map((i) => i.parentId!)), [items]);
  const collapsed = useMemo(() => new Set(items.filter((i) => folds.get(i.id) ?? !!i.folded).map((i) => i.id)), [items, folds]);
  const visible = useMemo(() => {
    const hiddenParents = new Set<string>();
    return items.filter((i) => {
      if (i.parentId && (collapsed.has(i.parentId) || hiddenParents.has(i.parentId))) {
        hiddenParents.add(i.id);
        return false;
      }
      return true;
    });
  }, [items, collapsed]);
  const order = visible.map((i) => i.id);
  const current = focusId && order.includes(focusId) ? focusId : (selection.find((s) => order.includes(s)) ?? order[0] ?? null);

  useEffect(() => {
    if (focusId && listRef.current?.contains(document.activeElement)) {
      listRef.current.querySelector<HTMLElement>(`[data-id="${CSS.escape(focusId)}"] .bc-row-name`)?.focus();
    }
  }, [focusId]);

  if (items.length === 0) return <>{empty}</>;

  const click = (id: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => {
    const r = clickSelect(order, selection, anchor.current, id, { shift: e.shiftKey, toggle: e.ctrlKey || e.metaKey });
    anchor.current = r.anchor;
    setFocusId(id);
    onSelect(r.selection);
  };
  const fold = (id: string, open: boolean) => setFolds((f) => new Map(f).set(id, !open));
  const renamable = (item: TreeItem) => !!onRename && item.rename !== false;

  const onKeyDown = (e: KeyboardEvent, item: TreeItem) => {
    if (renaming) return;
    const i = order.indexOf(item.id);
    const go = (j: number) => {
      const id = order[Math.max(0, Math.min(order.length - 1, j))];
      if (id) setFocusId(id);
    };
    switch (e.key) {
      case "ArrowDown":
        go(i + 1);
        break;
      case "ArrowUp":
        go(i - 1);
        break;
      case "Home":
        go(0);
        break;
      case "End":
        go(order.length - 1);
        break;
      case "ArrowRight":
        if (hasChildren.has(item.id) && collapsed.has(item.id)) fold(item.id, true);
        else if (hasChildren.has(item.id)) go(i + 1);
        break;
      case "ArrowLeft":
        if (hasChildren.has(item.id) && !collapsed.has(item.id)) fold(item.id, false);
        else if (item.parentId) setFocusId(item.parentId);
        break;
      case "Enter":
        click(item.id, { shiftKey: e.shiftKey, ctrlKey: false, metaKey: false });
        break;
      case " ":
        click(item.id, { shiftKey: false, ctrlKey: true, metaKey: false });
        break;
      case "F2":
        if (renamable(item)) setRenaming(item.id);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  const siblingsOf = (id: string) => {
    const p = items.find((i) => i.id === id)?.parentId ?? null;
    return items.filter((i) => (i.parentId ?? null) === p);
  };
  const onDragOver = (e: DragEvent, target: TreeItem) => {
    const id = dragId.current;
    // Onto a row that takes it (#334): the row lights up, and the drop moves it in.
    if (id && id !== target.id && target.into && onDropInto && items.find((i) => i.id === id)?.move) {
      e.preventDefault();
      setDropBefore(undefined);
      setDropInto(target.id);
      return;
    }
    setDropInto(null);
    if (!id || id === target.id || target.drag === false || !siblingsOf(id).some((s) => s.id === target.id)) return;
    e.preventDefault();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    const sibs = siblingsOf(id);
    const idx = sibs.findIndex((s) => s.id === target.id);
    setDropBefore(after ? (sibs[idx + 1]?.id ?? null) : target.id);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragId.current && dropInto) onDropInto?.(dragId.current, dropInto);
    else if (dragId.current && dropBefore !== undefined && dropBefore !== dragId.current) onReorder?.(dragId.current, dropBefore);
    dragId.current = null;
    setDropBefore(undefined);
    setDropInto(null);
  };

  return (
    <ul ref={listRef} className="bc-tree" role="tree" aria-label={label} aria-multiselectable="true">
      {visible.map((item) => {
        const selected = selection.includes(item.id);
        const d = depth.get(item.id) ?? 0;
        const parent = hasChildren.has(item.id);
        const lp = onContextMenu ? longPress((at) => onContextMenu(item.id, at)) : undefined;
        return (
          <li
            key={item.id}
            data-id={item.id}
            data-kind={item.kind}
            role="treeitem"
            aria-selected={selected}
            aria-level={d + 1}
            aria-expanded={parent ? !collapsed.has(item.id) : undefined}
            className={cx(
              "bc-row",
              selected && "bc-on",
              item.active && "bc-row-active",
              item.hidden && "bc-off",
              dropBefore === item.id && "bc-drop-before",
              dropInto === item.id && "bc-drop-into",
            )}
            style={{ ["--depth" as string]: d }}
            draggable={((!!onReorder && item.drag !== false) || (!!onDropInto && !!item.move)) && renaming !== item.id}
            onDragStart={(e) => {
              dragId.current = item.id;
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", item.name);
            }}
            onDragOver={(e) => onDragOver(e, item)}
            onDrop={onDrop}
            onDragEnd={() => {
              dragId.current = null;
              setDropBefore(undefined);
              setDropInto(null);
            }}
            onContextMenu={(e: MouseEvent) => {
              if (!onContextMenu) return;
              e.preventDefault();
              if (!selected) click(item.id, { shiftKey: false, ctrlKey: false, metaKey: false });
              onContextMenu(item.id, { x: e.clientX, y: e.clientY });
            }}
            {...lp}
          >
            {parent ? (
              <button
                type="button"
                className={cx("bc-disclose", !collapsed.has(item.id) && "bc-open")}
                aria-label={collapsed.has(item.id) ? `Show what is in ${item.name}` : `Fold ${item.name}`}
                tabIndex={-1}
                onClick={() => fold(item.id, collapsed.has(item.id))}
              >
                <Icon name="chevron" size={14} />
              </button>
            ) : (
              <span className="bc-disclose" aria-hidden="true" />
            )}
            {renaming === item.id ? (
              <RenameBox
                name={item.name}
                icon={item.icon ?? "cube"}
                onDone={(name) => {
                  setRenaming(null);
                  if (name && name !== item.name) onRename?.(item.id, name);
                  setFocusId(item.id);
                }}
              />
            ) : (
              <button
                type="button"
                className="bc-row-name"
                tabIndex={item.id === current ? 0 : -1}
                onClick={(e) => click(item.id, e)}
                onDoubleClick={() => !onOpen?.(item.id) && renamable(item) && setRenaming(item.id)}
                onKeyDown={(e) => onKeyDown(e, item)}
                onFocus={() => setFocusId(item.id)}
              >
                <Icon name={item.icon ?? "cube"} size={16} />
                <span>{item.name}</span>
                {item.note && <small className="bc-row-note">{item.note}</small>}
                {item.warning && (
                  <em className="bc-row-warning" data-tip={item.warning} aria-label={`Problem: ${item.warning}`}>
                    <Icon name="warning" size={14} />
                  </em>
                )}
              </button>
            )}
            {onToggle &&
              (item.toggles ?? toggles).map((t) => {
                const on = !!item[t];
                const inherited = !on && !!item.inherited?.[t];
                const def = TOGGLE[t];
                return (
                  <IconButton
                    key={t}
                    quiet
                    tabIndex={-1}
                    icon={on || inherited ? def.on : def.off}
                    title={`${on ? def.onTitle : def.offTitle} ${item.name}`}
                    on={on || inherited}
                    inherited={inherited}
                    onClick={() => onToggle(item.id, t)}
                  />
                );
              })}
          </li>
        );
      })}
      {dropBefore === null && <li className="bc-drop-end" aria-hidden="true" onDragOver={(e) => e.preventDefault()} onDrop={onDrop} />}
    </ul>
  );
}

function RenameBox({ name, icon, onDone }: { name: string; icon: IconName; onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v === null ? null : v.trim());
  };
  return (
    <span className="bc-row-name bc-renaming">
      <Icon name={icon} size={16} />
      <input
        className="bc-text bc-rename"
        aria-label={`Rename ${name}`}
        value={value}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setValue(e.currentTarget.value)}
        onBlur={() => finish(value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(value);
          else if (e.key === "Escape") {
            e.stopPropagation();
            e.preventDefault();
            finish(null);
          }
        }}
      />
    </span>
  );
}
