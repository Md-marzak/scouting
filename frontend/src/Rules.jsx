import { useEffect, useState } from "react";
import { api, LEVELS, ruleText } from "./api";
import Curve from "./Curve";

export default function Rules({ profile, setProfile, name, save }) {
  const vars = Object.keys(profile.variables);
  const outputs = profile.output;
  const rules = profile.rules;

  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");
  const [vsel, setVsel] = useState(vars[0]);
  const [saveName, setSaveName] = useState(name);
  const [brief, setBrief] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [proposal, setProposal] = useState(null);

  useEffect(() => setSaveName(name), [name]);

  // Aperçu en direct : les 5 meilleurs joueurs avec les règles en cours d'édition
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        setRes(await api.search({ profile, top: 5 }));
        setErr("");
      } catch (e) {
        setErr(e.message);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [profile]);

  // --- édition des règles ---
  const setRules = (rs) => setProfile({ ...profile, rules: rs.map((r, i) => ({ ...r, id: `R${i + 1}` })) });
  const patch = (i, d) => setRules(rules.map((r, k) => (k === i ? { ...r, ...d } : r)));
  const patchCond = (i, j, d) => patch(i, { if: rules[i].if.map((c, k) => (k === j ? { ...c, ...d } : c)) });
  const addCond = (i) => patch(i, { if: [...rules[i].if, { var: vars[0], is: "high" }] });
  const delCond = (i, j) => rules[i].if.length > 1 && patch(i, { if: rules[i].if.filter((_, k) => k !== j) });
  const addRule = () =>
    setRules([...rules, { if: [{ var: vars[0], is: "high" }], op: "AND", then: outputs[outputs.length - 1], weight: 1 }]);
  const delRule = (i) => setRules(rules.filter((_, k) => k !== i));

  // --- ensembles flous d'une variable ---
  const vcfg = profile.variables[vsel];
  const manual = Array.isArray(vcfg.params);
  const q = vcfg.params ?? res?.q_var?.[vsel];
  const setVar = (cfg) => setProfile({ ...profile, variables: { ...profile.variables, [vsel]: cfg } });
  const toggleManual = () => {
    if (manual) {
      const { params, ...rest } = vcfg;
      setVar(rest);
    } else if (q) {
      setVar({ ...vcfg, params: q.map((x) => Math.round(x * 10) / 10) });
    }
  };
  const moveQ = (k, val) => {
    const a = [...q];
    a[k] = val;
    for (let i = k + 1; i < 3; i++) a[i] = Math.max(a[i], a[i - 1]);
    for (let i = k - 1; i >= 0; i--) a[i] = Math.min(a[i], a[i + 1]);
    setVar({ ...vcfg, params: a });
  };

  // --- règles proposées par le LLM ---
  const suggest = async () => {
    setBusy(true);
    setAiErr("");
    setProposal(null);
    try {
      setProposal((await api.suggest({ brief, profile })).rules);
    } catch (e) {
      setAiErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rules-page">
      <section className="panel">
        <div className="save-row">
          <h2>Règles floues</h2>
          <label className="inline">
            Nom du profil
            <input value={saveName} onChange={(e) => setSaveName(e.target.value)} />
          </label>
          <button className="btn primary" onClick={() => save(saveName.trim())} disabled={!saveName.trim()}>
            Enregistrer le profil
          </button>
        </div>
        <p className="muted">Chaque règle combine des variables de la carte joueur. Le résultat change immédiatement dans l'aperçu.</p>

        <ol className="rule-list">
          {rules.map((r, i) => (
            <li key={i} className="rule">
              <div className="rule-head">
                <strong>{r.id}</strong>
                <label className="inline">
                  Poids {Number(r.weight ?? 1).toFixed(1)}
                  <input type="range" min="0.1" max="1" step="0.1" value={r.weight ?? 1}
                         onChange={(e) => patch(i, { weight: Number(e.target.value) })} />
                </label>
                <button className="btn ghost" onClick={() => delRule(i)} aria-label={`Supprimer la règle ${r.id}`}>Supprimer</button>
              </div>
              {r.if.map((c, j) => (
                <div className="cond" key={j}>
                  <span className="kw">{j === 0 ? "SI" : r.op === "OR" ? "OU" : "ET"}</span>
                  <select value={c.var} onChange={(e) => patchCond(i, j, { var: e.target.value })} aria-label="Variable">
                    {vars.map((v) => <option key={v}>{v}</option>)}
                  </select>
                  <span>est</span>
                  <select value={c.is} onChange={(e) => patchCond(i, j, { is: e.target.value })} aria-label="Niveau">
                    {LEVELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  {r.if.length > 1 && (
                    <button className="btn ghost sm" onClick={() => delCond(i, j)} aria-label="Retirer la condition">Retirer</button>
                  )}
                </div>
              ))}
              <div className="cond">
                <button className="btn ghost sm" onClick={() => addCond(i)}>Ajouter une condition</button>
                {r.if.length > 1 && (
                  <select value={r.op} onChange={(e) => patch(i, { op: e.target.value })} aria-label="Opérateur">
                    <option value="AND">Toutes les conditions (ET)</option>
                    <option value="OR">Une condition suffit (OU)</option>
                  </select>
                )}
                <span className="kw then">ALORS</span>
                <select value={r.then} onChange={(e) => patch(i, { then: e.target.value })} aria-label="Résultat">
                  {outputs.map((o) => <option key={o}>{o}</option>)}
                </select>
              </div>
            </li>
          ))}
        </ol>
        <button className="btn" onClick={addRule}>Ajouter une règle</button>
      </section>

      <aside className="side">
        <section className="panel">
          <h2>Aperçu : top 5</h2>
          {err && <div className="banner error" role="alert">{err}</div>}
          <ol className="mini">
            {res?.players.map((p) => (
              <li key={p.pid}><span>{p.name}</span><b>{p.score.toFixed(1)}</b></li>
            ))}
          </ol>
        </section>

        <section className="panel">
          <h2>Ensembles flous</h2>
          <label className="inline">
            Variable
            <select value={vsel} onChange={(e) => setVsel(e.target.value)}>
              {vars.map((v) => <option key={v}>{v}</option>)}
            </select>
          </label>
          <Curve q={q} />
          <label className="check">
            <input type="checkbox" checked={manual} onChange={toggleManual} />
            Régler les seuils à la main (sinon calculés sur les joueurs)
          </label>
          {manual && ["Seuil bas", "Seuil milieu", "Seuil haut"].map((lab, k) => (
            <label className="inline slider" key={lab}>
              {lab} {q[k].toFixed(0)}
              <input type="range" min="0" max="100" step="1" value={q[k]} onChange={(e) => moveQ(k, Number(e.target.value))} />
            </label>
          ))}
        </section>

        <section className="panel">
          <h2>Proposer des règles avec l'IA</h2>
          <p className="muted">Décris le besoin du client. L'IA propose des règles, tu décides lesquelles garder.</p>
          <textarea rows="3" value={brief} onChange={(e) => setBrief(e.target.value)}
                    placeholder="Un meneur de jeu créatif, bon passeur, qui dribble bien, la vitesse compte peu" />
          <button className="btn primary" onClick={suggest} disabled={busy || brief.trim().length < 8}>
            {busy ? "Analyse en cours…" : "Proposer des règles"}
          </button>
          {aiErr && <div className="banner error" role="alert">{aiErr}</div>}
          {proposal && (
            <div className="proposal">
              <ul>{proposal.map((r) => <li key={r.id}>{ruleText(r)}</li>)}</ul>
              <div className="btn-row">
                <button className="btn primary" onClick={() => { setRules(proposal); setProposal(null); }}>Remplacer mes règles</button>
                <button className="btn" onClick={() => { setRules([...rules, ...proposal]); setProposal(null); }}>Ajouter à mes règles</button>
                <button className="btn ghost" onClick={() => setProposal(null)}>Ignorer</button>
              </div>
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}
