import { Dialog } from "@bettercad/ui";
import { APP_VERSION } from "../version";
import { LIBRARIES, LICENCES_URL, SOURCE_URL } from "./about";

/** Help → About: the version, BetterCad's licence and the libraries it is built on (#110). */
export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} modal onCancel={onClose} onDone={onClose} title="About BetterCad" icon="info" footer={null}>
      <p>
        Version <strong>{APP_VERSION}</strong>. Free CAD for 3D printing, in your browser.
      </p>
      <p>
        BetterCad is MIT licensed.{" "}
        <a href={SOURCE_URL} target="_blank" rel="noreferrer">
          See the source on GitHub
        </a>
        .
      </p>
      <h3 className="bc-panel-title">Built with</h3>
      <dl className="bc-about-libs" aria-label="Libraries">
        {LIBRARIES.map((l) => (
          <div key={l.name}>
            <dt>
              <a href={l.url} target="_blank" rel="noreferrer">
                {l.name}
              </a>
            </dt>
            <dd>
              {l.use}. {l.licence}.
            </dd>
          </div>
        ))}
      </dl>
      <p className="bc-note">
        The LGPL libraries load as separate, unmodified files, so you can swap in your own build.{" "}
        <a href={LICENCES_URL} target="_blank" rel="noreferrer">
          Full licence details
        </a>
        .
      </p>
    </Dialog>
  );
}
