import { useCallback, useEffect, useState } from "react";

/** How long after start-up the notes load, so they never compete with first paint or the kernel. */
export const WHATS_NEW_DELAY_MS = 2500;

const check = () => import("./check");

/**
 * What's new after an update. A while after start-up it loads the release notes (their own chunk) and, when some are
 * newer than the last you saw, offers the card. Opening the list or dismissing the card marks them seen. The shell
 * holds only this hook; the notes and the bookmark load later.
 */
export function useWhatsNew(delay = WHATS_NEW_DELAY_MS) {
  const [fresh, setFresh] = useState<string[]>([]);
  const [card, setCard] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let gone = false;
    const t = setTimeout(() => {
      check().then(
        (m) => {
          const ids = m.freshNotes();
          if (!gone && ids.length) {
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

  const dismiss = useCallback(() => {
    setCard(false);
    check().then(
      (m) => m.markAllSeen(),
      () => undefined,
    );
  }, []);
  const show = useCallback(() => {
    dismiss();
    setOpen(true);
  }, [dismiss]);
  const close = useCallback(() => setOpen(false), []);

  return { fresh, card, open, show, dismiss, close };
}
