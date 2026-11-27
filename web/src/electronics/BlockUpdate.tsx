import { useEffect, useMemo, useState } from "react";
import { inflate, type ElectronicsDesign, type LibraryPack, type SchGroup } from "@bettercad/electronics";
import { buildBlock, type BlockSpec } from "@bettercad/electronics/blocks";
import { changedInside, updateBlock, whatChanged } from "@bettercad/electronics/blockUpdate";
import { STARTER_BLOCKS } from "@bettercad/electronics/library/blocks";
import { buildOwn, type OwnBlock } from "@bettercad/electronics/ownBlocks";
import { Button } from "@bettercad/ui";
import { useAccount } from "../cloud/account";
import type { EEdit } from "./actions";
import { useMyLibrary } from "./myLibrary";
import { loadStarter } from "./starter";

/**
 * A placed block's Update badge (#773): when its block has a newer version, what changed and an Update button. A
 * block whose inside you changed shows Changed, and Update asks before it replaces your changes.
 */
export default function BlockUpdate({ design, sheet, group, edit }: { design: ElectronicsDesign; sheet: string; group: SchGroup; edit: EEdit }) {
  const { api, account } = useAccount();
  const my = useMyLibrary(api, !!account);
  const block = group.block!;
  const own: OwnBlock | undefined = my.blocks.find((b) => b.spec.id === block.def);
  const spec: BlockSpec | undefined = own?.spec ?? STARTER_BLOCKS.find((b) => b.id === block.def);
  const newer = !!spec && spec.version > block.version;
  const [pack, setPack] = useState<LibraryPack | null>(null);
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState("");
  useEffect(() => {
    if (!newer || own) return;
    let live = true;
    loadStarter().then(
      (p) => live && setPack(p),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [newer, own]);
  const changed = useMemo(() => changedInside(design, sheet, group.id), [design, sheet, group.id]);
  const changes = useMemo(() => (newer && spec ? whatChanged(design, sheet, group.id, spec) : []), [newer, spec, design, sheet, group.id]);

  const update = () => {
    if (!spec) return;
    const lookup = (id: string) => {
      const part = pack?.parts.find((p) => p.id === id);
      return part && pack ? inflate(pack, part) : undefined;
    };
    let built;
    try {
      built = own ? buildOwn(own) : buildBlock(spec, lookup);
    } catch (e) {
      return setSaid(`The new version can't be built: ${(e as Error).message}`);
    }
    edit((d) => {
      const r = updateBlock(d, sheet, group.id, built);
      setSaid(
        r.gone.length
          ? `Updated to version ${spec.version}. ${r.gone.join(", ")} ${r.gone.length === 1 ? "is" : "are"} gone, so ${r.gone.length === 1 ? "its wire is" : "their wires are"} left where ${r.gone.length === 1 ? "it was" : "they were"}.`
          : `Updated to version ${spec.version}.`,
      );
      return r.design;
    }, `Update ${group.name}`);
    setAsking(false);
  };

  if (!newer)
    return (
      <>
        {changed && <p className="bc-note">Changed: you edited the inside of this block, so it is your own copy now.</p>}
        {said && (
          <p className="bc-note" role="status">
            {said}
          </p>
        )}
      </>
    );
  return (
    <section className="bc-ec-block-update" aria-label="Update">
      <p>
        <strong className="bc-ec-badge">Update</strong> Version {spec!.version} of this block is out. You have version {block.version}.
      </p>
      {changes.length > 0 && (
        <ul className="bc-ec-block-inside" aria-label="What changed">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {changed && <p className="bc-note">Changed: you edited the inside of this block. Updating replaces your changes.</p>}
      {asking ? (
        <div className="bc-ec-library-tools">
          <Button size="dense" variant="primary" label="Replace my changes" onClick={update} disabled={!own && !pack} />
          <Button size="dense" variant="secondary" label="Keep my copy" onClick={() => setAsking(false)} />
        </div>
      ) : (
        <Button
          size="dense"
          variant="primary"
          label="Update"
          title="Swap the inside for the new version. What is joined to its points stays joined"
          disabled={!own && !pack}
          onClick={() => (changed ? setAsking(true) : update())}
        />
      )}
      {said && (
        <p className="bc-note" role="status">
          {said}
        </p>
      )}
    </section>
  );
}
