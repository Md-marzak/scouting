import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import Hologram from "./Hologram";

const MODES = [["min", "au moins"], ["around", "environ"], ["max", "au plus"]];
const DEFAULTS = [["speed", "min", 32, 4], ["age", "max", 25, 3], ["dribbling", "min", 80, 3]];
const fmtValue = (v) => (v == null ? "valeur inconnue" : v >= 1e6 ? `${(v / 1e6).toFixed(1)} M€` : `${Math.round(v / 1e3)} k€`);

export default function Search({ profile }) {
  const [catalog, setCatalog] = useState([]);
  const [needs, setNeeds] = useState([]);
  const [strict, setStrict] = useState(false);
  const [ruleWeight, setRuleWeight] = useState(30);
  const [top, setTop] = useState(20);
  const [res, setRes] = useState(null);
  const [sel, setSel] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const requestSeq = useRef(0);

  useEffect(() => {
    api.catalog().then((c) => {
      setCatalog(c);
      setNeeds(DEFAULTS.filter(([id]) => c.some((x) => x.id === id)).map(([id, mode, value, importance]) => ({ id, mode, value, importance })));
    }).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!catalog.length) return;
    const seq = ++requestSeq.current;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.needsSearch({
          profile, strict, top, rule_weight: ruleWeight,
          needs: needs.filter((n) => n.value !== "").map((n) => ({ ...n, value: Number(n.value) })),
        });
        if (seq !== requestSeq.current) return;
        setRes(r);
        setErr("");
        setSel((s) => (r.players.some((p) => p.pid === s) ? s : r.players[0]?.pid ?? null));
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setErr(e.message);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [profile, needs, strict, ruleWeight, top, catalog]);

  const cat = (id) => catalog.find((c) => c.id === id);
  const used = new Set(needs.map((n) => n.id));
  const setNeed = (i, d) => setNeeds(needs.map((n, k) => (k === i ? { ...n, ...d } : n)));
  const addNeed = (id) => id && setNeeds([...needs, { id, mode: "min", value: cat(id).default, importance: 3 }]);
  const current = res?.players.find((p) => p.pid === sel);

  return (
    <div className="search">
      <section className="panel">
        <h2>Besoin du client</h2>
        <p className="muted">Saisis chaque critère avec son unité réelle, par exemple une vitesse de 32 km/h. L'importance (1 à 5) dit à quel point le critère est obligatoire.</p>

        <ul className="needs">
          {needs.map((n, i) => {
            const c = cat(n.id);
            if (!c) return null;
            return (
              <li key={n.id} className="need">
                <div className="need-line">
                  <select value={n.id} aria-label="Caractéristique"
                          onChange={(e) => setNeed(i, { id: e.target.value, value: cat(e.target.value).default })}>
                    {catalog.filter((x) => x.id === n.id || !used.has(x.id)).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                  <button className="btn ghost sm" onClick={() => setNeeds(needs.filter((_, k) => k !== i))}>Retirer</button>
                </div>
                <div className="need-line">
                  <select value={n.mode} aria-label="Condition" onChange={(e) => setNeed(i, { mode: e.target.value })}>
                    {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <input type="number" value={n.value} min={c.min} max={c.max} step={c.step}
                         aria-label={`Valeur en ${c.unit}`}
                         onChange={(e) => setNeed(i, { value: e.target.value === "" ? "" : Number(e.target.value) })} />
                  <span className="unit">{c.unit}</span>
                  <label className="inline grow">Importance {n.importance}
                    <input type="range" min="1" max="5" value={n.importance} onChange={(e) => setNeed(i, { importance: Number(e.target.value) })} />
                  </label>
                </div>
                {c.note && <p className="muted note">{c.note}</p>}
              </li>
            );
          })}
        </ul>

        <select className="add" value="" onChange={(e) => addNeed(e.target.value)} aria-label="Ajouter un critère">
          <option value="">Ajouter un critère…</option>
          {catalog.filter((c) => !used.has(c.id)).map((c) => <option key={c.id} value={c.id}>{c.label} ({c.unit})</option>)}
        </select>

        <div className="mix">
          <label>Combinaison des critères
            <select value={strict ? "strict" : "avg"} onChange={(e) => setStrict(e.target.value === "strict")}>
              <option value="avg">Compensatoire (moyenne pondérée)</option>
              <option value="strict">Stricte (ET flou pondéré)</option>
            </select>
          </label>
          <label>Poids du profil de poste (règles) : {ruleWeight} %
            <input type="range" min="0" max="100" step="5" value={ruleWeight} onChange={(e) => setRuleWeight(Number(e.target.value))} />
          </label>
          <label>Résultats affichés
            <input type="number" value={top} min="5" max="100" onChange={(e) => setTop(Number(e.target.value))} />
          </label>
        </div>

        {err && <div className="banner error" role="alert">{err}</div>}
        <p className="muted count">
          {loading && res ? "Mise à jour de l'analyse…" : res ? `${res.matching} joueurs sur ${res.total} satisfont bien l'ensemble des critères` : "Calcul en cours…"}
        </p>
        <ol className={loading ? "players is-updating" : "players"}>
          {res?.players.map((p, i) => (
            <li key={p.pid}>
              <button className={p.pid === sel ? "row active" : "row"} onClick={() => setSel(p.pid)}>
                <span className="rank">{i + 1}</span>
                <span className="who">
                  <strong>{p.name}</strong>
                  <span className="muted">{p.club}, {p.age} ans, {fmtValue(p.value_eur)}</span>
                </span>
                <span className="score">{p.final.toFixed(1)}
                  <small className={p.is_good ? "good" : "bad"}>{p.verdict}</small></span>
              </button>
            </li>
          ))}
        </ol>
      </section>
      <div className="stage-col"><Hologram p={current} /></div>
    </div>
  );
}
