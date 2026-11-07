import { useState } from "react";
import { Icon } from "@bettercad/ui";
import { SAMPLE_LIST, sampleThumb } from "./samples";

/** A row of the sample models (#99), for the editor's empty state, the library's and the tour's last step. */
export function SampleCards({ onOpen, title = "Or open a sample and pull it apart" }: { onOpen: (id: string) => void; title?: string }) {
  return (
    <section className="bc-samples" aria-label="Sample models">
      <h3 className="bc-samples-title">{title}</h3>
      <ul className="bc-samples-row">
        {SAMPLE_LIST.map((s) => (
          <li key={s.id}>
            <button type="button" className="bc-sample" onClick={() => onOpen(s.id)} aria-label={`Open the ${s.name.toLowerCase()} sample`}>
              <SampleThumb id={s.id} />
              <span className="bc-sample-name">{s.name}</span>
              <span className="bc-sample-blurb">{s.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SampleThumb({ id }: { id: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="bc-sample-thumb">
      {failed ? <Icon name="cube" size={32} /> : <img src={sampleThumb(id)} alt="" width={160} height={100} loading="lazy" onError={() => setFailed(true)} />}
    </span>
  );
}
