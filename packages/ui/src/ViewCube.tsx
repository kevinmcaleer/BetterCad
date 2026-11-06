export type ViewName = "top" | "front" | "right" | "iso";

/** The view cube in the viewport's top-right corner, as SVG. Click a face to look from it. */
export function ViewCube({ onPick }: { onPick?: (view: ViewName) => void }) {
  const face = (view: ViewName, points: string, label: string) => (
    <polygon className="bc-cube-face" points={points} onClick={() => onPick?.(view)}>
      <title>{label}</title>
    </polygon>
  );
  return (
    <svg className="bc-viewcube" viewBox="0 0 104 104" role="img" aria-label="View cube">
      <defs>
        <linearGradient id="bc-cube-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--bc-color-cube-face)" />
          <stop offset="1" stopColor="var(--bc-color-cube-face-low)" />
        </linearGradient>
      </defs>
      {face("top", "52,14 86,30 52,46 18,30", "Look from the top")}
      {face("front", "18,30 52,46 52,86 18,70", "Look from the front")}
      {face("right", "52,46 86,30 86,70 52,86", "Look from the right")}
      <text className="bc-cube-label" x="52" y="33" pointerEvents="none">
        TOP
      </text>
      <text className="bc-cube-label" x="35" y="46" transform="skewY(25)" pointerEvents="none">
        FRONT
      </text>
      <text className="bc-cube-label" x="69" y="94" transform="skewY(-25)" pointerEvents="none">
        RIGHT
      </text>
      <text className="bc-axis-x" x="92" y="84">
        X
      </text>
      <text className="bc-axis-y" x="4" y="84">
        Y
      </text>
      <text className="bc-axis-z" x="48" y="102">
        Z
      </text>
    </svg>
  );
}
