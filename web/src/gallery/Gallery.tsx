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
  PartRow,
  PartsTree,
  Rail,
  Separator,
  THEMES,
  Toolbar,
  ViewCube,
  WideButton,
  COLOURS,
  type IconName,
  type ThemeId,
} from "@bettercad/ui";

/** Every component in its states, under Light, Dark and Holodeck side by side. The visual check for UI changes. */
export function Gallery() {
  return (
    <div className="bc bc-gallery">
      <header className="bc-top">
        <span className="bc-title">
          <Icon name="cube" size={18} />
          <span>BetterCad components</span>
        </span>
        <span className="bc-grow" />
        <a className="bc-btn" href="#/">
          <Icon name="arrowStart" />
          <span>Back to the editor</span>
        </a>
      </header>
      <div className="bc-gallery-cols">
        {THEMES.map((t) => (
          <section key={t.id} data-theme={t.id} className="bc bc-gallery-col" aria-label={`${t.name} theme`}>
            <h1 className="bc-type-page-title">{t.name}</h1>
            <Column theme={t.id} />
          </section>
        ))}
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bc-gallery-block">
      <h2 className="bc-panel-title">{title}</h2>
      {children}
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

function Column({ theme }: { theme: ThemeId }) {
  const [w, setW] = useState(40);
  const [panel, setPanel] = useState("parts");
  return (
    <>
      <Block title="Colours">
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
      <Block title="Buttons">
        <div className="bc-gallery-row">
          <Button label="Plain" />
          <Button icon="move" label="Pressed" on />
          <Button icon="undo" title="Undo" shortcut="Ctrl+Z" />
          <Button label="Disabled" disabled />
        </div>
        <div className="bc-gallery-row">
          <Button kind="done" label="Done" />
          <Button kind="cancel" label="Cancel" />
          <Button kind="stale" icon="warning" label="Update" />
          <Button kind="snap" label="3 snaps" />
        </div>
        <div className="bc-gallery-row">
          <IconButton icon="eye" title="Hide" quiet />
          <IconButton icon="ghost" title="Ghost" quiet on />
          <IconButton icon="highlight" title="Highlight" quiet on inherited />
        </div>
        <WideButton icon="plus" label="Add a part" variant="outline" />
        <div style={{ height: 6 }} />
        <WideButton label="Primary wide" variant="primary" />
      </Block>
      <Block title="Toolbar">
        <Toolbar label={`Toolbar ${theme}`}>
          <Button icon="move" label="Move" on />
          <Button icon="rotate" label="Turn" />
          <Separator />
          <Button label="Iso" />
          <Button label="Top" />
          <Separator />
          <Button icon="frame" label="Fit" />
        </Toolbar>
        <div style={{ height: 8 }} />
        <ArmedBar title="Extrude" icon="extrude">
          <span className="bc-armed-note">Distance 10 mm</span>
          <Button kind="done" label="Done" />
        </ArmedBar>
      </Block>
      <Block title="Number fields">
        <Fields>
          <NumberField label="W" value={w} onChange={setW} />
          <NumberField label="Angle" value={45} unit="°" onChange={() => {}} precision={1} />
          <NumberField label="Z" value={12} onChange={() => {}} locked />
        </Fields>
      </Block>
      <Block title="Rail">
        <div className="bc-gallery-rail">
          <Rail
            label={`Rail ${theme}`}
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
      <Block title="Parts tree">
        <PartsTree label={`Parts ${theme}`}>
          <PartRow name="Base plate" selected buttons={<IconButton icon="eye" title="Hide" quiet />} />
          <PartRow name="Bracket" icon="cylinder" buttons={<IconButton icon="eye" title="Hide" quiet />} />
          <PartRow name="Hidden lid" hidden buttons={<IconButton icon="eyeOff" title="Show" quiet on />} />
          <PartRow name="Imported" depth={1} warning="Missing file" />
        </PartsTree>
      </Block>
      <Block title="Menu">
        <Menu
          open
          autoFocus={false}
          onClose={() => {}}
          label={`Menu ${theme}`}
          title="Base plate"
          entries={[
            { id: "r", label: "Rename…", icon: "pencil", keys: "F2", onSelect: () => {} },
            { id: "d", label: "Duplicate", icon: "copy", keys: "Ctrl+D", onSelect: () => {} },
            { id: "x", label: "Disabled item", icon: "lock", disabled: true, onSelect: () => {} },
            { kind: "separator", id: "s" },
            { id: "del", label: "Delete", icon: "trash", danger: true, keys: "Del", onSelect: () => {} },
          ]}
        />
      </Block>
      <Block title="Dialog">
        <Dialog
          inline
          open
          title="Extrude"
          icon="extrude"
          onClose={() => {}}
          footer={
            <>
              <Button kind="cancel" label="Cancel" />
              <Button kind="done" label="Done" />
            </>
          }
        >
          <p className="bc-note">Pick a closed profile, then set the distance.</p>
          <Fields>
            <NumberField label="Distance" value={10} onChange={() => {}} />
          </Fields>
        </Dialog>
      </Block>
      <Block title="Banner">
        <Banner action={<Button kind="stale" label="Update" />}>This view is out of date.</Banner>
      </Block>
      <Block title="View cube and grid">
        <div className="bc-frame bc-gallery-view">
          <ViewCube />
        </div>
      </Block>
      <Block title="Icons">
        <div className="bc-icon-grid">
          {(Object.keys(ICONS) as IconName[]).map((n) => (
            <div key={n} title={n}>
              <Icon name={n} size={18} />
              <span>{n}</span>
            </div>
          ))}
        </div>
      </Block>
    </>
  );
}
