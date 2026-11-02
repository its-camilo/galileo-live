import type { Dict } from "@/lib/i18n";

const RAMP = { x1: 40, y1: 210, x2: 470, y2: 70 };
const TICKS = 6;

export function Trajectory({ T }: { T: Dict }) {
  const path = `M${RAMP.x1} ${RAMP.y1} L${RAMP.x2} ${RAMP.y2}`;
  const marks = Array.from({ length: TICKS + 1 }, (_, k) => {
    const f = (k / TICKS) ** 2;
    return { k, x: RAMP.x1 + (RAMP.x2 - RAMP.x1) * f, y: RAMP.y1 + (RAMP.y2 - RAMP.y1) * f };
  });
  const keyframes = marks
    .map((m, k) => `${((k / TICKS) * 100).toFixed(2)}% { offset-distance: ${(((k / TICKS) ** 2) * 100).toFixed(2)}%; }`)
    .join(" ");

  return (
    <figure className="ramp" aria-label={T.rampCaption}>
      <div className="ramp-frame">
      <div className="ramp-stage" style={{ width: 520, height: 260 }}>
        <svg width="520" height="260" viewBox="0 0 520 260" aria-hidden="true">
          <path className="ramp-line" d={path} pathLength={1} />
          <line className="ramp-base" x1="40" y1="210" x2="470" y2="210" />
          {marks.map((m) => (
            <g key={m.k} className="ramp-mark" style={{ animationDelay: `${0.9 + m.k * 0.12}s` }}>
              <line x1={m.x} y1={m.y - 9} x2={m.x} y2={m.y + 9} />
              <text x={m.x} y={m.y - 14} textAnchor="middle">
                {m.k}
              </text>
            </g>
          ))}
        </svg>
        <div className="cart" style={{ offsetPath: `path("${path}")` }} aria-hidden="true" />
        <style>{`@keyframes roll { ${keyframes} }`}</style>
      </div>
      </div>
      <figcaption>
        <span className="readout">
          a = 0.86 m/s²
        </span>
        <span className="example">{T.exampleLabel}</span>
        <span className="caption">{T.rampCaption}</span>
      </figcaption>
    </figure>
  );
}
