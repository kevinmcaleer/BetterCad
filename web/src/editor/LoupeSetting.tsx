import { useState } from "react";
import { loupeAuto, setLoupeAuto } from "../state/loupePref";

/** The magnifier loupe (#387): some people would rather it never opened by itself. */
export default function LoupeSetting() {
  const [on, setOn] = useState(loupeAuto);
  return (
    <>
      <h2 className="bc-panel-title">Loupe</h2>
      <label className="bc-check">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setLoupeAuto(e.target.checked);
            setOn(e.target.checked);
          }}
        />
        <span>Open the loupe where points crowd</span>
      </label>
      <p className="bc-note">It magnifies points that sit close together in sketches and joints. Hold Alt to open it any time.</p>
    </>
  );
}
