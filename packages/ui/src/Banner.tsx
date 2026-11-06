import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { cx } from "./cx";

export type BannerTone = "warn" | "danger" | "info";

export interface BannerProps {
  children: ReactNode;
  tone?: BannerTone;
  /** An action under the text, such as Update or Choose the file again. */
  action?: ReactNode;
}

const ICON = { warn: "warning", danger: "warning", info: "info" } as const;
const WORD = { warn: "Warning", danger: "Error", info: "Note" } as const;

/**
 * An inline strip in a side panel. Warnings and notes are announced politely; errors assertively. Each carries an
 * icon and a word as well as its colour.
 */
export function Banner({ children, tone = "warn", action }: BannerProps) {
  return (
    <div className={cx("bc-banner", `bc-banner-${tone}`)} role={tone === "danger" ? "alert" : "status"}>
      <p className="bc-banner-text">
        <Icon name={ICON[tone]} size={16} />
        <span>
          <strong className="bc-sr-only">{WORD[tone]}: </strong>
          {children}
        </span>
      </p>
      {action && <p>{action}</p>}
    </div>
  );
}
