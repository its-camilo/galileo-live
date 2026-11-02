type Props = { t: number[]; y: number[]; label: string; unit: string };

export function Plot({ t, y, label, unit }: Props) {
  if (t.length < 2) return null;
  const W = 320;
  const H = 180;
  const P = 34;
  const xmin = t[0];
  const xmax = t[t.length - 1];
  let ymin = Math.min(...y);
  let ymax = Math.max(...y);
  if (ymax === ymin) {
    ymin -= 1;
    ymax += 1;
  }
  const sx = (v: number) => P + ((v - xmin) / (xmax - xmin || 1)) * (W - 2 * P);
  const sy = (v: number) => H - P - ((v - ymin) / (ymax - ymin)) * (H - 2 * P);
  const d = t.map((tv, i) => `${i ? "L" : "M"}${sx(tv).toFixed(1)},${sy(y[i]).toFixed(1)}`).join(" ");
  const zeroY = ymin < 0 && ymax > 0 ? sy(0) : null;

  return (
    <figure className="plot">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <line className="plot-axis" x1={P} y1={H - P} x2={W - P} y2={H - P} />
        <line className="plot-axis" x1={P} y1={P} x2={P} y2={H - P} />
        {zeroY !== null && <line className="plot-zero" x1={P} y1={zeroY} x2={W - P} y2={zeroY} />}
        <path className="plot-trace" d={d} />
        <text className="plot-tick" x={P} y={H - 8}>
          {xmin.toFixed(1)} s
        </text>
        <text className="plot-tick" x={W - P} y={H - 8} textAnchor="end">
          {xmax.toFixed(1)} s
        </text>
        <text className="plot-tick" x={P - 4} y={P + 4} textAnchor="end">
          {ymax.toFixed(2)}
        </text>
        <text className="plot-tick" x={P - 4} y={H - P} textAnchor="end">
          {ymin.toFixed(2)}
        </text>
      </svg>
      <figcaption>
        {label} <span className="unit">[{unit}]</span>
      </figcaption>
    </figure>
  );
}
