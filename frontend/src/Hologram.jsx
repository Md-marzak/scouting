import { useEffect, useState } from "react";

const fmtValue = (v) => (v == null ? "valeur inconnue" : v >= 1e6 ? `${(v / 1e6).toFixed(1)} M€` : `${Math.round(v / 1e3)} k€`);

export default function Hologram({ p }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [p?.pid]);

  if (!p) return <section className="holo empty"><p>Sélectionne un joueur dans la liste pour l'afficher ici.</p></section>;
  const showPhoto = p.face && !broken;

  return (
    <section className="holo" aria-label={`Fiche hologramme de ${p.name}`}>
      <div className="holo-stage" aria-hidden="true">
        <div className="beam" />
        <div className="base" />
        <div className="base2" />
        <div className="figure" key={p.pid}>
          {showPhoto ? (
            <img className="photo" src={p.face} alt="" onError={() => setBroken(true)} />
          ) : (
            <svg className="sil" width="130" height="200" viewBox="0 0 100 160" fill="#19e3ff44" stroke="#19e3ff" strokeWidth="2">
              <circle cx="50" cy="22" r="16" />
              <path d="M20 150 L28 70 Q50 52 72 70 L80 150 Z" />
            </svg>
          )}
        </div>
        <div className="sweep" />
        <div className="scan" />
      </div>

      <div className="holo-info">
        <h2>{p.name}</h2>
        <p className="holo-sub">{[p.club, p.nation].filter(Boolean).join(", ")}</p>
        <p className="holo-sub">{p.age} ans, note {p.overall}, {fmtValue(p.value_eur)}</p>

        <div className="holo-score">
          <span>{p.final != null ? "Compatibilité" : "Score flou"}</span>
          <b>{(p.final ?? p.score).toFixed(1)}</b>
          <strong className={p.is_good ? "verdict good" : "verdict bad"}>{p.verdict}</strong>
        </div>
        {p.final != null && (
          <p className="holo-sub">Besoins du client {p.needs_score} %, profil de poste {p.score.toFixed(1)}</p>
        )}

        {p.needs?.length > 0 && (
          <>
            <h3>Critères du client</h3>
            <ul className="needs-res">
              {p.needs.map((n) => (
                <li key={n.id}>
                  <span>{n.label}</span>
                  <b>{n.actual}</b>
                  <em>{n.target}</em>
                  <i className={n.sat >= 80 ? "ok" : n.sat >= 40 ? "mid" : "ko"}>{n.sat} %</i>
                </li>
              ))}
            </ul>
          </>
        )}

        <ul className="bars" aria-label="Percentile parmi les milieux offensifs">
          {Object.entries(p.bars).map(([k, v]) => (
            <li key={k}>
              <span>{k}</span>
              <div className="bar"><i key={`${p.pid}-${k}-${v}`} style={{ "--w": `${v}%` }} /></div>
              <b>{v}</b>
            </li>
          ))}
        </ul>

        <h3>Règles du poste déclenchées</h3>
        <ul className="fired">
          {p.rules.length === 0 && <li>Aucune règle fortement déclenchée.</li>}
          {p.rules.map((r) => (
            <li key={r.id}><b>{r.strength.toFixed(2)}</b> {r.text}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
