import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode } from "react";
import { Icon } from "@bettercad/ui";
import "./pages.css";

/**
 * The pages outside the editor (#88, #89): a slim bar with the brand and a way back to the editor, then the page's
 * title and body in the design system's page styles at a 65-character measure.
 */
export function Page({ title, wide, children, bar }: { title: string; wide?: boolean; children: ReactNode; bar?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    document.title = `${title} · BetterCad`;
    heading.current?.focus();
  }, [title]);
  return (
    <div className="bc bc-page">
      <header className="bc-page-bar">
        <a className="bc-page-brand" href="#/">
          <Icon name="cube" size={18} />
          <span>BetterCad</span>
        </a>
        <span className="bc-grow" />
        {bar}
      </header>
      <main className={wide ? "bc-page-main bc-page-wide" : "bc-page-main"}>
        <h1 className="bc-page-title" tabIndex={-1} ref={heading}>
          {title}
        </h1>
        {children}
      </main>
    </div>
  );
}

/** A labelled text field with its error underneath, never in a modal. */
export function Field({ label, error, hint, ...input }: { label: string; error?: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className="bc-page-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="bc-text"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-e` : hint ? `${id}-h` : undefined}
        {...input}
      />
      {error ? (
        <span className="bc-page-error" id={`${id}-e`}>
          {error}
        </span>
      ) : hint ? (
        <span className="bc-page-hint" id={`${id}-h`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

/** A line that goes red when it's a problem. */
export function FormError({ text }: { text: string | null }) {
  return text ? (
    <p className="bc-page-error" role="alert">
      {text}
    </p>
  ) : null;
}
