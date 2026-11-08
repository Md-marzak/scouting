const clamp = (v) => Math.max(0, Math.min(1, v));
const COLORS = { low: "#3b6fb6", mid: "#7a7f87", high: "#1b6b47" };

export default function Curve({ q }) {
  if (!q) return null;
  const [q25, q50, q75] = q;
  const d1 = Math.max(q50 - q25, 1e-6);
  const d2 = Math.max(q75 - q50, 1e-6);
  const d3 = Math.max(q75 + 0.5 * (100 - q75) - q50, 1e-6);
  const f = {
    low: (x) => clamp((q50 - x) / d1),
    mid: (x) => clamp(Math.min((x - q25) / d1, (q75 - x) / d2)),
    high: (x) => clamp((x - q50) / d3),
  };
  const W = 300, H = 130, P = 22;
  const X = (x) => P + (x / 100) * (W - 2 * P);
  const Y = (y) => H - P - y * (H - 2 * P);
  const pts = (fn) => Array.from({ length: 101 }, (_, i) => `${X(i).toFixed(1)},${Y(fn(i)).toFixed(1)}`).join(" ");

  return (
    <figure className="curve">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Courbes d'appartenance Faible, Moyen et Élevé">
        <line x1={P} y1={Y(0)} x2={W - P} y2={Y(0)} stroke="#9fb0bc" />
        {[0, 50, 100].map((t) => (
          <text key={t} x={X(t)} y={H - 6} fontSize="9" textAnchor="middle" fill="#5b6c79">{t}</text>
        ))}
        {q.map((v, i) => (
          <line key={i} x1={X(v)} x2={X(v)} y1={Y(1)} y2={Y(0)} stroke="#9fb0bc" strokeDasharray="2 3" />
        ))}
        {Object.keys(f).map((k) => (
          <polyline key={k} points={pts(f[k])} fill="none" stroke={COLORS[k]} strokeWidth="2" />
        ))}
      </svg>
      <figcaption>
        <span><i style={{ background: COLORS.low }} />Faible</span>
        <span><i style={{ background: COLORS.mid }} />Moyen</span>
        <span><i style={{ background: COLORS.high }} />Élevé</span>
        <span className="muted">repères : {q.map((x) => x.toFixed(0)).join(", ")}</span>
      </figcaption>
    </figure>
  );
}
