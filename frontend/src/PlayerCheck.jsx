import { useEffect, useState } from "react";
import { api } from "./api";

export default function PlayerCheck({ profile }) {
  const variables = Object.keys(profile.variables);
  const [name, setName] = useState("");
  const [attributes, setAttributes] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAttributes(Object.fromEntries(variables.map((variable) => [variable, ""])));
    setResult(null);
    setError("");
  }, [profile]);

  const evaluate = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const evaluated = await api.evaluatePlayer({
        name,
        profile,
        attributes: Object.fromEntries(
          variables.map((variable) => [variable, Number(attributes[variable])]),
        ),
      });
      setResult(evaluated);
    } catch (e) {
      setError(e.message);
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="custom-page">
      <section className="panel">
        <h2>Évaluer mon joueur</h2>
        <p className="muted">
          Entre le nom et la moyenne des notes de la carte pour chaque catégorie.
          Le système compare ces notes aux joueurs du poste, applique les ensembles
          flous et les règles du profil sélectionné.
        </p>
        <form onSubmit={evaluate}>
          <label className="player-name">
            Nom du joueur
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength="80"
              required
              placeholder="Ex. Mon joueur CAM"
            />
          </label>
          <div className="attribute-grid">
            {variables.map((variable) => (
              <label key={variable}>
                {variable} <span className="muted">(note moyenne 0–99)</span>
                <input
                  type="number"
                  min="0"
                  max="99"
                  step="1"
                  required
                  value={attributes[variable] ?? ""}
                  onChange={(event) =>
                    setAttributes({ ...attributes, [variable]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? "Évaluation…" : "Évaluer l’adéquation au poste"}
          </button>
        </form>

        {error && <div className="banner error" role="alert">{error}</div>}
      </section>

      {result && (
        <section className="panel custom-result" aria-live="polite">
          <div className="result-heading">
            <div>
              <p className="eyebrow">Résultat pour</p>
              <h2>{result.name}</h2>
            </div>
            <div className="result-score">
              <strong>{result.score.toFixed(1)}</strong>
              <span className={result.is_good ? "good" : "bad"}>{result.verdict}</span>
            </div>
          </div>
          <p>
            {result.is_good
              ? "Selon les informations saisies et les règles actuelles, ce joueur semble adapté au poste."
              : "Selon les informations saisies et les règles actuelles, ce joueur semble moins adapté au poste."}
          </p>
          <h3>Règles déclenchées</h3>
          {result.rules.length ? (
            <ul className="custom-rules">
              {result.rules.map((rule) => (
                <li key={rule.id}>
                  <strong>{rule.id}</strong>
                  <span>{rule.text}</span>
                  <b>{Math.round(rule.strength * 100)} %</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Aucune règle ne s’est déclenchée fortement avec ces notes.</p>
          )}
        </section>
      )}
    </div>
  );
}
