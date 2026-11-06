import type { ReactNode } from "react";

export interface BannerProps {
  children: ReactNode;
  /** An action button under the text, such as Update. */
  action?: ReactNode;
}

/** A warning in a side panel: warn-soft fill, warn-ink text. Announced politely to screen readers. */
export function Banner({ children, action }: BannerProps) {
  return (
    <div className="bc-banner" role="status">
      <p>{children}</p>
      {action && <p>{action}</p>}
    </div>
  );
}
