import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./Button";
import type { IconName } from "./icons";
import { Icon } from "./Icon";
import { cx } from "./cx";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  icon?: IconName;
  children: ReactNode;
  footer?: ReactNode;
  /** Modal dialogs sit on a scrim and trap focus; floating ones (the joint dialog) do not. */
  modal?: boolean;
  /** Render in place rather than fixed (component gallery). */
  inline?: boolean;
  width?: number;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A dialog with a title bar, body and footer. Esc closes; focus returns to where it was. */
export function Dialog({ open, onClose, title, icon, children, footer, modal = true, inline, width }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open || inline) return;
    const before = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(".bc-dialog-body " + FOCUSABLE) ?? ref.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    return () => before?.focus?.();
  }, [open, inline]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
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

  const box = (
    <div
      ref={ref}
      role="dialog"
      aria-modal={modal && !inline ? true : undefined}
      aria-labelledby={titleId}
      className={cx("bc-dialog", !inline && "bc-dialog-fixed")}
      style={width ? { width } : undefined}
      onKeyDown={onKeyDown}
    >
      <div className="bc-dialog-head">
        {icon && <Icon name={icon} size={18} />}
        <span id={titleId} className="bc-grow">
          {title}
        </span>
        <IconButton icon="close" title="Close (Esc)" onClick={onClose} />
      </div>
      <div className="bc-dialog-body">{children}</div>
      {footer && <div className="bc-dialog-foot">{footer}</div>}
    </div>
  );
  if (inline || !modal) return box;
  return (
    <div className="bc-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      {box}
    </div>
  );
}
