import { useCallback, useEffect, useRef, useState } from "react";
import { loadSeen, saveSeen, unseenIds } from "./seen";

/** How long after start-up the notes load, so they never compete with first paint or the kernel. */
export const WHATS_NEW_DELAY_MS = 2500;

/**
 * What's new after an update. A while after start-up it loads the release notes (their own chunk) and, when some are
 * newer than the last you saw, offers the card. Opening the list or dismissing the card marks them seen. A first
 * visit marks everything seen without a card.
 */
export function useWhatsNew(delay = WHATS_NEW_DELAY_MS) {
  const [fresh, setFresh] = useState<string[]>([]);
  const [card, setCard] = useState(false);
  const [open, setOpen] = useState(false);
  const all = useRef<string[]>([]);

  useEffect(() => {
    let gone = false;
    const t = setTimeout(() => {
      void import("./notes").then(
        ({ NOTES }) => {
          if (gone || !NOTES.length) return;
          all.current = NOTES.map((n) => n.id);
          const seen = loadSeen();
          const ids = unseenIds(all.current, seen);
          if (seen === null) saveSeen(all.current);
          if (ids.length) {
            setFresh(ids);
            setCard(true);
          }
        },
        () => undefined,
      );
    }, delay);
    return () => {
      gone = true;
      clearTimeout(t);
    };
  }, [delay]);

  const markSeen = useCallback(() => {
    if (all.current.length) saveSeen(all.current);
    setCard(false);
  }, []);
  const show = useCallback(() => {
    markSeen();
    setOpen(true);
  }, [markSeen]);
  const close = useCallback(() => setOpen(false), []);

  return { fresh, card, open, show, dismiss: markSeen, close };
}
