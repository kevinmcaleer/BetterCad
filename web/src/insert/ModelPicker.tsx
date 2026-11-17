import { useEffect, useMemo, useState } from "react";
import { Banner, Button, ContextMenu, IconButton, PartsTree, type ContextMenuState, type MenuEntry } from "@bettercad/ui";
import type { Api, ModelSummary } from "../cloud/api";
import { placesApi } from "../pages/placesApi";
import type { Tree } from "../pages/places";
import type { Placeable } from "../catalogue/usePlacePart";
import { savedItem } from "./InsertModelDialog";
import { filterItems, modelOfRow, pickerItems } from "./pickerTree";

export interface ModelPickerProps {
  api: Api;
  signedIn: boolean;
  /** The model open now, which can't go inside itself. */
  current?: string;
  /** A model was read and is ready to place, as a linked component. */
  onInsert: (m: Placeable) => void;
  onClose: () => void;
}

/**
 * The model picker (#480): your projects, folders and models in a tree beside the browser. Right-click a model (or
 * double-click it, or pick it and press Insert) to bring it into this model as a linked component.
 */
export function ModelPicker({ api, signedIn, current, onInsert, onClose }: ModelPickerProps) {
  const [tree, setTree] = useState<Tree | null>(null);
  const [models, setModels] = useState<ModelSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [menu, setMenu] = useState<{ id: string; at: ContextMenuState } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (!signedIn) return;
    let gone = false;
    Promise.all([placesApi(api).places(), api.list({ sort: "name" })]).then(
      ([t, l]) => {
        if (gone) return;
        setTree(t);
        setModels(l.models);
      },
      (e: Error) => !gone && setProblem(e.message),
    );
    return () => {
      gone = true;
    };
  }, [api, signedIn]);

  const all = useMemo(() => (tree && models ? pickerItems(tree, models, current) : []), [tree, models, current]);
  const items = useMemo(() => filterItems(all, q), [all, q]);
  const nameOf = (id: string) => models?.find((m) => m.id === id)?.name ?? "this model";
  const picked = selection.map(modelOfRow).find((id): id is string => !!id && id !== current) ?? null;

  const insert = async (id: string) => {
    if (id === current || busy) return;
    setBusy(id);
    setProblem(null);
    try {
      onInsert(await savedItem(api, id));
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const entries = (rowId: string): MenuEntry[] => {
    const id = modelOfRow(rowId);
    if (!id) return [];
    return [
      {
        id: "insert",
        label: id === current ? "Open now: can't go inside itself" : "Insert as a linked component",
        icon: "insertModel",
        disabled: id === current,
        onSelect: () => void insert(id),
      },
      { id: "open", label: "Open in a new tab", icon: "forward", onSelect: () => window.open(`#/edit/${encodeURIComponent(id)}`, "_blank", "noopener") },
    ];
  };

  return (
    <div className="bc-picker-body">
      <div className="bc-parts-head">
        <h2 className="bc-panel-title">My models</h2>
        <IconButton icon="chevron" title="Hide my models" quiet className="bc-picker-hide" onClick={onClose} />
      </div>
      {!signedIn ? (
        <p className="bc-note">Sign in to see your projects and models here and insert them into this one.</p>
      ) : (
        <>
          <input
            className="bc-text"
            type="search"
            aria-label="Search your models"
            placeholder="Search your models"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {problem && <Banner tone="danger">{problem}</Banner>}
          {models === null ? (
            !problem && <p className="bc-note">Finding your models…</p>
          ) : (
            <PartsTree
              label="Your models"
              items={items}
              selection={selection}
              onSelect={setSelection}
              toggles={[]}
              onContextMenu={(id, at) => modelOfRow(id) && setMenu({ id, at })}
              onOpen={(rowId) => {
                const id = modelOfRow(rowId);
                if (id) void insert(id);
                return true;
              }}
              empty={<p className="bc-note">{q ? "No models match that." : "No saved models yet. Save one to your account and it shows here."}</p>}
            />
          )}
          <p className="bc-note">Right-click a model to insert it as a linked component.</p>
          <Button
            variant="secondary"
            size="wide"
            busy={!!busy}
            label={busy ? `Reading ${nameOf(busy)}…` : "Insert"}
            icon="insertModel"
            title={picked ? `Insert ${nameOf(picked)} as a linked component` : "Pick a model to insert"}
            disabled={!picked || !!busy}
            onClick={() => picked && void insert(picked)}
          />
        </>
      )}
      <ContextMenu
        at={menu?.at ?? null}
        label="Model actions"
        title={menu ? items.find((i) => i.id === menu.id)?.name : undefined}
        entries={menu ? entries(menu.id) : []}
        onClose={() => setMenu(null)}
      />
    </div>
  );
}
