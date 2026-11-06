import { useState, type ReactNode } from "react";
import {
  ArmedBar,
  Banner,
  Button,
  Dialog,
  Fields,
  ICONS,
  Icon,
  IconButton,
  Menu,
  NumberField,
  PartsTree,
  PropRow,
  PropsPanel,
  Rail,
  THEMES,
  ToolButton,
  Toolbar,
  TooltipLayer,
  TooltipSample,
  ViewCube,
  WideButton,
  COLOURS,
  type IconName,
  type ThemeId,
  type TreeItem,
} from "@bettercad/ui";

/**
 * Every component in its states, under Light, Dark and Holodeck side by side. The visual check for UI changes:
 * the Playwright screenshot tests photograph each block. Hover, focus and pressed are pinned with data-state so a
 * screenshot shows them without a pointer.
 */
export function Gallery() {
  return (
    <div className="bc bc-gallery">
      <header className="bc-top">
        <span className="bc-title">
          <Icon name="cube" size={18} />
          <span className="bc-brand">BetterCad components</span>
        </span>
        <span className="bc-grow" />
        <a className="bc-btn" href="#/">
          <Icon name="arrowStart" />
          <span>Back to the editor</span>
        </a>
      </header>
      <main className="bc-gallery-cols">
        {THEMES.map((t) => (
          <section key={t.id} data-theme={t.id} className="bc bc-gallery-col" aria-labelledby={`bc-gal-${t.id}`}>
            <h1 className="bc-type-page-title" id={`bc-gal-${t.id}`}>
              {t.name}
            </h1>
            <Column theme={t.id} />
          </section>
        ))}
      </main>
      <TooltipLayer />
    </div>
  );
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <div className="bc-gallery-block" data-block={id}>
      <h2 className="bc-panel-title">{title}</h2>
      {children}
    </div>
  );
}

function State({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bc-gallery-state">
      {children}
      <small>{label}</small>
    </div>
  );
}

const SWATCHES = [
  "accent",
  "accent-soft",
  "ink",
  "muted",
  "line",
  "bar",
  "rail",
  "stage",
  "viewport",
  "snap",
  "picked",
  "danger",
  "warn",
  "grid",
  "grid-major",
  "axis-x",
  "axis-y",
  "axis-z",
] as const;

const TREE: TreeItem[] = [
  { id: "plate", name: "Base plate", icon: "cube" },
  { id: "sketch", name: "Sketch 1", icon: "sketch", parentId: "plate" },
  { id: "bracket", name: "Bracket", icon: "cylinder", ghost: true },
  { id: "lid", name: "Lid", icon: "cube", hidden: true },
  { id: "screw", name: "Screw hole", icon: "hole", parentId: "lid", inherited: { hidden: true } },
  { id: "imported", name: "Imported part", icon: "body", warning: "The file it came from is missing", highlight: true },
];

function Column({ theme }: { theme: ThemeId }) {
  const [w, setW] = useState<number | null>(40);
  const [panel, setPanel] = useState<string | null>("parts");
  const [tool, setTool] = useState("move");
  const [selection, setSelection] = useState<string[]>(["plate"]);
  const [items, setItems] = useState(TREE);
  return (
    <>
      <Block id="colours" title="Colours">
        <div className="bc-swatches">
          {SWATCHES.map((s) => (
            <div key={s} className="bc-swatch-tile">
              <span style={{ background: `var(--bc-color-${s})` }} />
              <code>{s}</code>
              <small>{COLOURS[theme][s]}</small>
            </div>
          ))}
        </div>
      </Block>

      <Block id="buttons" title="Buttons">
        <div className="bc-gallery-row">
          <Button variant="primary" label="Primary" />
          <Button variant="secondary" label="Secondary" />
          <Button label="Quiet" />
          <Button variant="danger" icon="trash" label="Delete" />
        </div>
        <div className="bc-gallery-row">
          <State label="Rest">
            <Button variant="secondary" label="Save" />
          </State>
          <State label="Hover">
            <Button variant="secondary" label="Save" data-state="hover" />
          </State>
          <State label="Focus">
            <Button variant="secondary" label="Save" data-state="focus" />
          </State>
          <State label="Pressed">
            <Button variant="secondary" label="Save" on />
          </State>
          <State label="Off">
            <Button variant="secondary" label="Save" disabled title="Nothing to save yet" />
          </State>
          <State label="Busy">
            <Button variant="primary" label="Save" busy />
          </State>
        </div>
        <div className="bc-gallery-row">
          <Button size="dense" label="Dense" />
          <Button label="Control" />
          <Button icon="undo" title="Undo" shortcut="Ctrl+Z" />
        </div>
        <div className="bc-gallery-row">
          <Button kind="done" label="Done" />
          <Button kind="cancel" label="Cancel" />
          <Button kind="stale" icon="warning" label="Update" />
          <Button kind="snap" label="3 snaps" />
        </div>
        <div className="bc-gallery-row">
          <IconButton icon="eye" title="Hide" quiet />
          <IconButton icon="ghost" title="Show as a reference" quiet on />
          <IconButton icon="highlight" title="Highlight" quiet on inherited />
        </div>
        <WideButton icon="plus" label="Add a part" variant="outline" />
        <div className="bc-gallery-gap" />
        <WideButton label="Primary wide" variant="primary" />
      </Block>

      <Block id="toolbar" title="Toolbar">
        <Toolbar label={`Tools, ${theme}`}>
          {(
            [
              ["select", "arrow", "Select", "V"],
              ["move", "move", "Move", "M"],
              ["turn", "rotate", "Turn", "R"],
            ] as const
          ).map(([id, icon, label, key]) => (
            <ToolButton key={id} icon={icon} label={label} shortcut={key} pressed={tool === id} onPress={() => setTool(id)} />
          ))}
          <Toolbar.Separator />
          <Button label="Iso" on />
          <Button label="Top" />
          <Toolbar.Separator />
          <Button icon="frame" label="Fit" />
        </Toolbar>
        <div className="bc-gallery-gap" />
        <ArmedBar title="Extrude" icon="extrude">
          <span className="bc-armed-note">Distance 10 mm</span>
          <Button kind="done" label="Done" />
        </ArmedBar>
        <div className="bc-gallery-gap" />
        <TooltipSample text="Move (M)" />
      </Block>

      <Block id="fields" title="Number fields">
        <Fields>
          <NumberField label="W" value={w} onChange={setW} />
          <NumberField label="Angle" value={45} unit="deg" onChange={() => {}} />
          <NumberField label="Z" value={12} onChange={() => {}} locked />
          <NumberField label="D" value={null} onChange={() => {}} />
        </Fields>
        <p className="bc-note">D shows “–” because the selected parts differ. Type a sum such as 40/2 + 5.</p>
      </Block>

      <Block id="rail" title="Rail">
        <div className="bc-gallery-rail">
          <Rail
            label={`Rail, ${theme}`}
            value={panel}
            onChange={setPanel}
            items={[
              { id: "parts", icon: "layers", label: "Parts" },
              { id: "sketch", icon: "sketch", label: "Sketch" },
              { id: "settings", icon: "settings", label: "Settings" },
            ]}
          />
        </div>
      </Block>

      <Block id="tree" title="Parts tree">
        <PartsTree
          label={`Parts, ${theme}`}
          items={items}
          selection={selection}
          onSelect={setSelection}
          toggles={["hidden", "ghost", "highlight"]}
          onToggle={(id, what) => setItems((list) => list.map((it) => (it.id === id ? { ...it, [what]: !it[what] } : it)))}
          onRename={(id, name) => setItems((list) => list.map((it) => (it.id === id ? { ...it, name } : it)))}
        />
      </Block>

      <Block id="props" title="Properties">
        <PropsPanel
          label={`Properties, ${theme}`}
          sections={[
            {
              id: `gal-part-${theme}`,
              title: "This part",
              content: (
                <>
                  <PropRow label="Name">Base plate</PropRow>
                  <PropRow label="Shape">Box</PropRow>
                </>
              ),
            },
            {
              id: `gal-size-${theme}`,
              title: "Size",
              content: (
                <Fields>
                  <NumberField label="W" value={40} onChange={() => {}} />
                  <NumberField label="D" value={20} onChange={() => {}} />
                  <NumberField label="H" value={5} onChange={() => {}} />
                </Fields>
              ),
            },
          ]}
        />
      </Block>

      <Block id="menu" title="Menu">
        <Menu
          open
          autoFocus={false}
          onClose={() => {}}
          label={`Part actions, ${theme}`}
          title="Base plate"
          entries={[
            { id: "r", label: "Rename", icon: "pencil", keys: "F2", onSelect: () => {} },
            { id: "d", label: "Duplicate", icon: "copy", keys: "Ctrl+D", onSelect: () => {} },
            { id: "x", label: "Export (coming soon)", icon: "lock", disabled: true, onSelect: () => {} },
            { kind: "separator", id: "s" },
            { id: "del", label: "Delete", icon: "trash", danger: true, keys: "Del", onSelect: () => {} },
          ]}
        />
      </Block>

      <Block id="dialog" title="Dialog">
        <Dialog inline open title="Extrude" icon="extrude" onCancel={() => {}} onDone={() => {}}>
          <p className="bc-note">Pick a closed profile, then set the distance.</p>
          <Fields>
            <NumberField label="Distance" value={10} onChange={() => {}} />
          </Fields>
        </Dialog>
      </Block>

      <Block id="banner" title="Banners">
        <Banner tone="warn" action={<Button kind="stale" label="Update" />}>
          This view is out of date.
        </Banner>
        <div className="bc-gallery-gap" />
        <Banner tone="danger">The fillet is bigger than the edge. Try 2 mm or less.</Banner>
        <div className="bc-gallery-gap" />
        <Banner tone="info">The 3D view arrives with epic #3.</Banner>
      </Block>

      <Block id="view" title="View cube and grid">
        <div className="bc-frame bc-gallery-view">
          <ViewCube />
        </div>
      </Block>

      <Block id="icons" title="Icons">
        <div className="bc-icon-grid">
          {(Object.keys(ICONS) as IconName[]).map((n) => (
            <div key={n}>
              <Icon name={n} size={18} />
              <span>{n}</span>
            </div>
          ))}
        </div>
      </Block>
    </>
  );
}
