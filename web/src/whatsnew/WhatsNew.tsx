import { Fragment } from "react";
import { Button, Dialog, IconButton } from "@bettercad/ui";
import { NOTES, blocks, byDay, dayLabel, spans, type ReleaseNote } from "./notes";

function Inline({ text }: { text: string }) {
  return (
    <>
      {spans(text).map((s, i) =>
        s.kind === "strong" ? <strong key={i}>{s.text}</strong> : s.kind === "code" ? <code key={i}>{s.text}</code> : <Fragment key={i}>{s.text}</Fragment>,
      )}
    </>
  );
}

function Note({ note, fresh }: { note: ReleaseNote; fresh: boolean }) {
  return (
    <article className="bc-whatsnew-note" aria-labelledby={`note-${note.id}`}>
      <h4 id={`note-${note.id}`}>
        {note.title}
        {fresh && <span className="bc-whatsnew-new">New</span>}
      </h4>
      {blocks(note.body).map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>
            <Inline text={b.text} />
          </p>
        ) : (
          <ul key={i}>
            {b.items.map((t, j) => (
              <li key={j}>
                <Inline text={t} />
              </li>
            ))}
          </ul>
        ),
      )}
    </article>
  );
}

/** Help → What's new: every release note, newest day first, with the ones you hadn't seen marked New. */
export function WhatsNewDialog({ fresh, onClose }: { fresh: readonly string[]; onClose: () => void }) {
  const isNew = new Set(fresh);
  return (
    <Dialog open modal onCancel={onClose} title="What's new" icon="star" footer={null} width={520}>
      <div className="bc-whatsnew">
        {byDay(NOTES).map((day) => (
          <section key={day.date} aria-label={dayLabel(day.date)}>
            <h3 className="bc-panel-title">{dayLabel(day.date)}</h3>
            {day.notes.map((n) => (
              <Note key={n.id} note={n} fresh={isNew.has(n.id)} />
            ))}
          </section>
        ))}
      </div>
    </Dialog>
  );
}

/** The note after an update: the new feature names, a way to read more, and a way to put it away. */
export function WhatsNewCard({ fresh, onOpen, onDismiss }: { fresh: readonly string[]; onOpen: () => void; onDismiss: () => void }) {
  const titles = fresh.map((id) => NOTES.find((n) => n.id === id)?.title).filter((t): t is string => !!t);
  if (!titles.length) return null;
  const shown = titles.slice(0, 3);
  const more = titles.length - shown.length;
  return (
    <aside className="bc-whatsnew-card" aria-label="What's new">
      <div className="bc-whatsnew-head">
        <strong>New in BetterCad</strong>
        <IconButton icon="close" title="Dismiss" quiet onClick={onDismiss} />
      </div>
      <ul>
        {shown.map((t) => (
          <li key={t}>{t}</li>
        ))}
        {more > 0 && <li>and {more} more</li>}
      </ul>
      <Button size="dense" variant="primary" label="See what's new" onClick={onOpen} />
    </aside>
  );
}
