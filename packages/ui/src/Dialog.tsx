import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "./Button";
import type { IconName } from "./icons";
import { Icon } from "./Icon";
import { cx } from "./cx";
import { useEscape } from "./useEscape";
import { overlayRoot } from "./overlay";

export interface DialogProps {
  open: boolean;
  title: string;
  icon?: IconName;
  children: ReactNode;
  /** Esc, the close button and Cancel. */
  onCancel: () => void;
  /** Enter and Done. Leave out for a dialog with only a Close. */
  onDone?: () => void;
  doneLabel?: string;
  /** Replaces the Cancel/Done footer. */
  footer?: ReactNode;
  /**
   * Modal dialogs sit on a scrim and trap focus. Modelling dialogs (Extrude, the joint dialog) are not modal,
   * so you can keep picking in the view.
   */
  modal?: boolean;
  /** Done is dimmed to 60% while the kernel works. */
  busy?: boolean;
  /** Render in place rather than over the page (component gallery). */
  inline?: boolean;
  width?: number;
  /** An extra class on the dialog box, for one that needs its own size or place. */
  className?: string;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A dialog with a title bar you can drag, a body and Cancel/Done. Enter is Done, Esc is Cancel. */
export function Dialog({
  open,
  title,
  icon,
  children,
  onCancel,
  onDone,
  doneLabel = "Done",
  footer,
  modal = false,
  busy,
  inline,
  width,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  useEscape(open && !inline, onCancel);

  useEffect(() => {
    if (!open || inline) return;
    setOffset({ x: 0, y: 0 });
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(".bc-dialog-body " + FOCUSABLE) ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => before?.focus?.();
  }, [open, inline]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.key === "Enter" && onDone && !busy && target.tagName !== "TEXTAREA" && target.tagName !== "BUTTON" && !e.defaultPrevented) {
      e.preventDefault();
      onDone();
    } else if (e.key === "Tab" && modal) {
      const els = Array.from(ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (!els.length) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const onHeadDown = (e: PointerEvent) => {
    if (inline || (e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onHeadMove = (e: PointerEvent) => {
    const d = drag.current;
    if (d) setOffset({ x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y });
  };
  const onHeadUp = () => {
    drag.current = null;
  };

  const foot =
    footer ??
    (onDone ? (
      <>
        <Button kind="cancel" label="Cancel" onClick={onCancel} />
        <Button variant="primary" label={doneLabel} busy={busy} onClick={onDone} />
      </>
    ) : null);

  const box = (
    <div
      ref={ref}
      role="dialog"
      aria-modal={modal && !inline ? true : undefined}
      aria-labelledby={titleId}
      aria-busy={busy || undefined}
      className={cx("bc-dialog", !inline && "bc-dialog-float", modal && !inline && "bc-dialog-modal", className)}
      style={{ width, transform: offset.x || offset.y ? `translate(${offset.x}px, ${offset.y}px)` : undefined }}
      onKeyDown={onKeyDown}
    >
      <div className="bc-dialog-head" onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp}>
        {icon && <Icon name={icon} size={18} />}
        <span id={titleId} className="bc-grow">
          {title}
        </span>
        <IconButton icon="close" title="Close (Esc)" onClick={onCancel} />
      </div>
      <div className="bc-dialog-body">{children}</div>
      {foot && <div className="bc-dialog-foot">{foot}</div>}
    </div>
  );
  if (inline) return box;
  if (!modal) return createPortal(box, overlayRoot());
  return createPortal(
    <div className="bc-scrim" onPointerDown={(e) => e.target === e.currentTarget && onCancel()}>
      {box}
    </div>,
    overlayRoot(),
  );
}
