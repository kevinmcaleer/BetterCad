import { useId, useRef, useState } from "react";
import type { ElectronicsDesign } from "@bettercad/electronics";
import { applyScript, describeChanges, touchedParts } from "@bettercad/electronics/script/api";
import type { ScriptRun } from "@bettercad/electronics/script/run";
import { STARTER_PLUGINS, pluginFile, readPluginFile, type Plugin } from "@bettercad/electronics/script/starters";
import { Button, ESC, FeaturePanel, PanelNote, useEscape } from "@bettercad/ui";
import { useAccount } from "../cloud/account";
import type { EEdit } from "./actions";
import { textOf } from "./fileText";
import { useMyLibrary } from "./myLibrary";
import { eui } from "./ui";

/** Runs a script in the sandbox. The app's is a locked-down worker; a test hands in its own. */
export type RunScript = (design: ElectronicsDesign, source: string) => Promise<ScriptRun>;
const sandbox: RunScript = (d, source) => import("./scriptClient").then((m) => m.runInSandbox(d, source));

const DRAFT = "bettercad.script";
const readDraft = () => {
  try {
    return localStorage.getItem(DRAFT);
  } catch {
    return null;
  }
};
const keepDraft = (text: string) => {
  try {
    localStorage.setItem(DRAFT, text);
  } catch {
    // A private window: the draft lasts as long as the card.
  }
};

const fileName = (name: string) =>
  `${
    name
      .trim()
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "plug-in"
  }.bcplugin.js`;

const FIRST = `// Scripts use bc: bc.parts(), bc.nets(), bc.board(), bc.setValue(ref, value), bc.move(ref, [x, y], turn)…
// Nothing changes until you choose Keep. See Help for the whole list.
for (const p of bc.parts()) bc.say(p.ref, p.value);
`;

function saveText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * The Script card (#764): JavaScript that reads and changes the design through `bc`, run in a sandbox with no network.
 * A run shows what it would change, in words and lit up on the view; Keep applies it as one undo step named after the
 * script, Throw away drops it. A script you name and save is a plug-in (#764): it goes in Your plug-ins, kept with your
 * parts and blocks, and saves as a `.bcplugin.js` file to pass on.
 */
export default function Script({
  design,
  edit,
  readOnly,
  onClose,
  run = sandbox,
}: {
  design: ElectronicsDesign;
  edit: EEdit;
  readOnly?: boolean;
  onClose: () => void;
  run?: RunScript;
}) {
  const ids = useId();
  const [source, setSource] = useState(() => readDraft() ?? FIRST);
  const [name, setName] = useState("Script");
  const [about, setAbout] = useState("");
  // The plug-in of yours that is open, so saving again saves over it.
  const [mine, setMine] = useState<string>();
  const [said, setSaid] = useState("");
  const [state, setState] = useState<{ busy: boolean; run?: ScriptRun }>({ busy: false });
  const { api, account } = useAccount();
  const my = useMyLibrary(api, !!account);
  const picker = useRef<HTMLInputElement>(null);
  useEscape(true, onClose, ESC.panel);

  const open = (p: Plugin, id?: string) => {
    setSource(p.source);
    setName(p.name);
    setAbout(p.description);
    setMine(id);
    setSaid("");
    keepDraft(p.source);
    setState({ busy: false });
  };
  const savePlugin = () => {
    const id = mine ?? `plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const plugin = { id, at: Date.now(), name: name.trim() || "Script", description: about.trim(), source };
    my.savePlugin(plugin);
    setMine(id);
    setName(plugin.name);
    setSaid(`Saved ${plugin.name} in Your plug-ins`);
  };
  const openFile = async (file: File) => {
    const p = readPluginFile(await textOf(file), file.name);
    open(p);
    setSaid(`Opened ${p.name}. Save it to keep it in Your plug-ins.`);
  };
  const ownOpen = my.plugins.find((p) => p.id === mine);

  const go = async () => {
    setState({ busy: true });
    const got = await run(design, source);
    setState({ busy: false, run: got });
    eui.set({ selected: got.error ? [] : touchedParts(design, got.changes) });
  };
  const keep = () => {
    const changes = state.run?.changes ?? [];
    edit((d) => applyScript(d, changes), `Run ${name}`);
    setState({ busy: false });
  };
  const done = state.run;
  const pending = !!done && !done.error && done.changes.length > 0;

  return (
    <FeaturePanel title="Script" icon="code" className="bc-ec-card bc-ec-script" cancel={{ label: "Close", title: "Close the script (Esc)", onClick: onClose }}>
      <label className="bc-field-label" htmlFor={`${ids}s`}>
        Start from
      </label>
      <select
        id={`${ids}s`}
        className="bc-select"
        value=""
        onChange={(e) => {
          const v = e.target.value;
          const own = my.plugins.find((x) => `y:${x.id}` === v);
          const starter = STARTER_PLUGINS.find((x) => `s:${x.name}` === v);
          if (own) open(own, own.id);
          else if (starter) open(starter);
        }}
      >
        <option value="">A plug-in…</option>
        {my.plugins.length > 0 && (
          <optgroup label="Your plug-ins">
            {[...my.plugins]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((p) => (
                <option key={p.id} value={`y:${p.id}`} title={p.description}>
                  {p.name}
                </option>
              ))}
          </optgroup>
        )}
        <optgroup label="Starter plug-ins">
          {STARTER_PLUGINS.map((p) => (
            <option key={p.name} value={`s:${p.name}`} title={p.description}>
              {p.name}
            </option>
          ))}
        </optgroup>
      </select>
      <label className="bc-field-label" htmlFor={`${ids}n`}>
        Name
      </label>
      <input id={`${ids}n`} className="bc-text" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="bc-field-label" htmlFor={`${ids}d`}>
        What it does
      </label>
      <input id={`${ids}d`} className="bc-text" value={about} placeholder="Lines the LEDs up round a circle" onChange={(e) => setAbout(e.target.value)} />
      <label className="bc-field-label" htmlFor={`${ids}t`}>
        JavaScript
      </label>
      <textarea
        id={`${ids}t`}
        className="bc-text bc-ec-script-text"
        spellCheck={false}
        rows={12}
        value={source}
        onChange={(e) => {
          setSource(e.target.value);
          keepDraft(e.target.value);
        }}
      />
      <div className="bc-ec-set-row">
        <Button
          variant="primary"
          label={state.busy ? "Running…" : "Run"}
          title="Run the script on a copy of the design; you see what it would change first"
          disabled={readOnly || state.busy || pending}
          onClick={() => void go()}
        />
        {state.busy && (
          <Button variant="secondary" label="Stop" title="Stop the script" onClick={() => void import("./scriptClient").then((m) => m.stopScript())} />
        )}
      </div>
      <div className="bc-ec-set-row">
        <Button
          size="dense"
          variant="secondary"
          label={ownOpen ? "Save the plug-in" : "Save as a plug-in"}
          title={ownOpen ? `Save your changes to ${ownOpen.name}` : "Keep this script in Your plug-ins, with your parts and blocks"}
          disabled={!source.trim()}
          onClick={savePlugin}
        />
        <Button size="dense" variant="quiet" label="Open a file…" title="Open a .bcplugin.js file someone gave you" onClick={() => picker.current?.click()} />
        <Button
          size="dense"
          variant="quiet"
          label="Save the file"
          title="Save the script as a .bcplugin.js file to pass on"
          disabled={!source.trim()}
          onClick={() => saveText(fileName(name), pluginFile({ name: name.trim() || "Script", description: about.trim(), source }))}
        />
        {ownOpen && (
          <Button
            size="dense"
            variant="danger"
            label="Delete"
            title={`Delete ${ownOpen.name} from Your plug-ins`}
            onClick={() => {
              my.removePlugin(ownOpen.id);
              setMine(undefined);
              setSaid(`Deleted ${ownOpen.name}`);
            }}
          />
        )}
        <input
          ref={picker}
          type="file"
          accept=".js,.bcplugin.js,text/javascript"
          hidden
          aria-label="Plug-in file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void openFile(f);
          }}
        />
      </div>
      {said && <PanelNote live>{said}</PanelNote>}
      <PanelNote>Scripts run in a sandbox: they can't reach the network or your files, and stop after 10 s.</PanelNote>

      {done?.error && <PanelNote tone="error">{done.error}</PanelNote>}
      {done && done.output.length > 0 && (
        <div className="bc-ec-script-out" aria-label="Script output" role="log">
          {done.output.map((o, i) =>
            o.kind === "say" ? (
              <p key={i}>{o.text}</p>
            ) : o.kind === "table" ? (
              <table key={i} className="bc-ec-script-table">
                <tbody>
                  {o.rows.map((r, k) => (
                    <tr key={k}>{r.map((c, j) => (k === 0 ? <th key={j}>{c}</th> : <td key={j}>{c}</td>))}</tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Button
                key={i}
                size="dense"
                variant="secondary"
                label={`Save ${o.name}`}
                title="Save the file the script made"
                onClick={() => saveText(o.name, o.text)}
              />
            ),
          )}
        </div>
      )}
      {done && !done.error && (
        <PanelNote live>
          {describeChanges(done.changes)}
          {done.changes.length ? "." : ". It only showed what it found."}
        </PanelNote>
      )}
      {pending && (
        <div className="bc-ec-set-row">
          <Button variant="primary" label="Keep" title="Make the changes, as one step you can undo" disabled={readOnly} onClick={keep} />
          <Button
            variant="secondary"
            label="Throw away"
            title="Leave the design as it was"
            onClick={() => (setState({ busy: false }), eui.set({ selected: [] }))}
          />
        </div>
      )}
    </FeaturePanel>
  );
}
