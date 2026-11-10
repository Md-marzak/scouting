import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";

const LABELS = {
  movement_acceleration: "Accélération",
  movement_sprint_speed: "Vitesse de sprint",
  mentality_positioning: "Placement offensif",
  attacking_finishing: "Finition",
  power_shot_power: "Puissance de tir",
  power_long_shots: "Tirs de loin",
  attacking_volleys: "Volées",
  mentality_penalties: "Penaltys",
  mentality_vision: "Vision",
  attacking_crossing: "Centres",
  skill_fk_accuracy: "Précision coups francs",
  attacking_short_passing: "Passes courtes",
  skill_long_passing: "Passes longues",
  skill_curve: "Effet",
  movement_agility: "Agilité",
  movement_balance: "Équilibre",
  movement_reactions: "Réactivité",
  skill_ball_control: "Contrôle de balle",
  skill_dribbling: "Dribbles",
  mentality_composure: "Sang-froid",
  mentality_interceptions: "Interceptions",
  attacking_heading_accuracy: "Précision de tête",
  defending_marking_awareness: "Marquage",
  defending_standing_tackle: "Tacle debout",
  defending_sliding_tackle: "Tacle glissé",
  power_jumping: "Détente",
  power_stamina: "Endurance",
  power_strength: "Force",
  mentality_aggression: "Agressivité",
};

const humanize = (value) => value.replaceAll("_", " ");

function Radar({ categories }) {
  const entries = Object.entries(categories);
  const center = 120;
  const radius = 86;
  const point = (index, value) => {
    const angle = (Math.PI * 2 * index) / entries.length - Math.PI / 2;
    const distance = radius * Math.max(0, Math.min(100, value)) / 100;
    return [center + Math.cos(angle) * distance, center + Math.sin(angle) * distance];
  };
  const shape = entries.map(([, value], index) => point(index, value).join(",")).join(" ");

  return (
    <svg className="player-radar" viewBox="0 0 240 240" role="img" aria-label="Profil des catégories du joueur">
      {[25, 50, 75, 100].map((level) => (
        <polygon
          key={level}
          points={entries.map((_, index) => point(index, level).join(",")).join(" ")}
          className="radar-grid"
        />
      ))}
      {entries.map(([label], index) => {
        const [x, y] = point(index, 100);
        return <line key={label} x1={center} y1={center} x2={x} y2={y} className="radar-axis" />;
      })}
      <polygon points={shape} className="radar-shape" />
      {entries.map(([label], index) => {
        const [x, y] = point(index, 112);
        return <text key={label} x={x} y={y} className="radar-label">{label}</text>;
      })}
    </svg>
  );
}

function ScoreRing({ score, verdict, isGood }) {
  return (
    <div
      className={`score-ring${isGood ? " is-good" : ""}`}
      style={{ "--score-angle": `${Math.max(0, Math.min(100, score)) * 3.6}deg` }}
      aria-label={`Score ${score} sur 100 : ${verdict}`}
    >
      <div className="score-ring-inner">
        <strong>{Math.round(score)}</strong>
        <span>/ 100</span>
      </div>
    </div>
  );
}

export default function PlayerCheck({ profile }) {
  const variables = Object.entries(profile.variables);
  const columns = useMemo(
    () => variables.flatMap(([, config]) => config.cols),
    [profile],
  );
  const [name, setName] = useState("");
  const [attributes, setAttributes] = useState({});
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiExplanation, setAiExplanation] = useState("");
  const [aiError, setAiError] = useState("");
  const [brief, setBrief] = useState("");
  const [interpretBusy, setInterpretBusy] = useState(false);
  const [interpretError, setInterpretError] = useState("");
  const [runId, setRunId] = useState(0);
  const [analyzedStamp, setAnalyzedStamp] = useState("");
  const requestId = useRef(0);
  const explainId = useRef(0);
  const reportRef = useRef(null);
  const columnKey = columns.join("\n");
  const columnsSeen = useRef(columnKey);
  const profileStamp = useMemo(() => JSON.stringify(profile), [profile]);

  useEffect(() => {
    setAttributes((current) => {
      const next = Object.fromEntries(columns.map((column) => [column, current[column] ?? ""]));
      const same = columns.length === Object.keys(current).length
        && columns.every((column) => current[column] === next[column]);
      return same ? current : next;
    });
  }, [columnKey, columns]);

  useEffect(() => {
    if (columnsSeen.current === columnKey) return;
    columnsSeen.current = columnKey;
    setResult(null);
    setRunId(0);
    setAnalyzedStamp("");
    setError("");
    setAiExplanation("");
    setAiError("");
    setInterpretError("");
  }, [columnKey]);

  useEffect(() => {
    if (!runId) return;
    reportRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [runId]);

  const interpret = async () => {
    setInterpretBusy(true);
    setInterpretError("");
    try {
      const response = await api.interpretPlayer({ brief, profile });
      setAttributes((current) => {
        const next = { ...current };
        for (const [column, value] of Object.entries(response.attributes)) {
          if (columns.includes(column)) next[column] = String(value);
        }
        return next;
      });
      if (!name.trim() && response.name) setName(response.name);
      setResult(null);
      setRunId(0);
      setAnalyzedStamp("");
      setAiExplanation("");
      setAiError("");
    } catch (e) {
      setInterpretError(e.message);
    } finally {
      setInterpretBusy(false);
    }
  };

  const readPlayer = (form) => {
    const data = new FormData(form);
    const playerName = String(data.get("playerName") || "").trim();
    const nextAttributes = Object.fromEntries(
      columns.map((column) => [column, Number(data.get(column))]),
    );
    return { playerName, nextAttributes };
  };

  const evaluate = async (event) => {
    event.preventDefault();
    const { playerName, nextAttributes } = readPlayer(event.currentTarget);
    if (!playerName || columns.some((column) => !Number.isFinite(nextAttributes[column]))) {
      setError("Renseigne le nom et toutes les notes avant de relancer l'analyse.");
      return;
    }
    const id = ++requestId.current;
    explainId.current += 1;
    setAiBusy(false);
    setName(playerName);
    setAttributes(Object.fromEntries(columns.map((column) => [column, String(nextAttributes[column])])));
    setBusy(true);
    setError("");
    setAiExplanation("");
    setAiError("");
    try {
      const evaluated = await api.evaluatePlayer({
        name: playerName,
        profile,
        attributes: nextAttributes,
      });
      if (id !== requestId.current) return;
      setAnalyzedStamp(profileStamp);
      setRunId(id);
      setResult({ ...evaluated, generatedAt: Date.now() });
    } catch (e) {
      if (id !== requestId.current) return;
      setError(e.message);
    } finally {
      if (id === requestId.current) setBusy(false);
    }
  };

  const explainWithAi = async () => {
    const id = ++explainId.current;
    setAiBusy(true);
    setAiError("");
    setAiExplanation("");
    try {
      const response = await api.explainPlayer({
        name,
        profile,
        attributes: Object.fromEntries(columns.map((column) => [column, Number(attributes[column])])),
      });
      if (id !== explainId.current) return;
      setAiExplanation(response.explanation);
    } catch (e) {
      if (id !== explainId.current) return;
      setAiError(e.message);
    } finally {
      if (id === explainId.current) setAiBusy(false);
    }
  };

  const previews = useMemo(() => Object.fromEntries(variables.map(([variable, config]) => {
    const entered = config.cols
      .map((column) => attributes[column])
      .filter((value) => value !== "" && value != null)
      .map(Number);
    return [variable, {
      average: entered.length ? entered.reduce((sum, value) => sum + value, 0) / entered.length : null,
      count: entered.length,
      total: config.cols.length,
    }];
  })), [attributes, profile]);

  const strengths = result
    ? Object.entries(result.categories).sort((a, b) => b[1] - a[1])
    : [];
  const topRule = result?.rules[0];
  const profileChanged = Boolean(result && analyzedStamp && analyzedStamp !== profileStamp);
  const updatedAt = result?.generatedAt
    ? new Date(result.generatedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";

  return (
    <div className="player-lab">
      <section className="lab-hero">
        <div className="hero-orbit orbit-one" />
        <div className="hero-orbit orbit-two" />
        <div className="lab-hero-copy">
          <span className="lab-kicker"><i /> LABORATOIRE DE SCOUTING <i /></span>
          <h2>Le joueur,<br /><em>décrypté.</em></h2>
          <p>Pars des notes de sa carte. On transforme ses attributs en profil de poste, puis on laisse les règles floues trancher.</p>
        </div>
        <div className="hero-stamp">
          <span>POSTE ANALYSÉ</span>
          <strong>{profile.groupe || "MOC"}</strong>
          <small>{profile.name}</small>
        </div>
        <div className="hero-mark" aria-hidden="true">01</div>
      </section>

      <form className="player-form" autoComplete="off" onSubmit={evaluate}>
        <section className="identity-panel">
          <div className="section-index">01 <span>IDENTITÉ DU PROSPECT</span></div>
          <label className="identity-field">
            Nom du joueur
            <input
              name="playerName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength="80"
              required
              autoComplete="off"
              placeholder="Ex. Nouveau numéro 10"
            />
          </label>
          <p className="identity-tip"><b>SCOUT NOTE</b> Les notes demandées sont celles de la carte, sur 99. Tu n’as pas à calculer les catégories toi-même.</p>
        </section>

        <section className="brief-panel">
          <div>
            <div className="section-index">01 <span>DESCRIPTION LIBRE</span></div>
            <h3>Du français aux notes.</h3>
          </div>
          <label className="brief-field">
            Décris le joueur
            <textarea
              rows="3"
              value={brief}
              onChange={(event) => setBrief(event.target.value)}
              placeholder="Très bon tireur, rapide sur les premiers mètres, passes correctes, faible en défense."
            />
          </label>
          <button
            className="btn evaluate-btn brief-btn"
            type="button"
            onClick={interpret}
            disabled={interpretBusy || brief.trim().length < 8}
          >
            {interpretBusy ? "Traduction…" : "Traduire en notes"}
          </button>
          {interpretError && <div className="banner error" role="alert">{interpretError}</div>}
        </section>

        <div className="attribute-heading">
          <div>
            <div className="section-index">02 <span>ATTRIBUTS DE LA CARTE</span></div>
            <h3>Les détails font le joueur.</h3>
          </div>
          <p>Entre les notes individuelles. Les indicateurs verts se calculent en direct.</p>
        </div>

        <div className="attribute-groups">
          {variables.map(([variable, config], index) => {
            const preview = previews[variable];
            return (
              <section className={`attribute-card attribute-card-${index % 6}`} key={variable}>
                <header className="attribute-card-head">
                  <span className="attribute-number">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h3>{variable}</h3>
                    <p>{config.cols.length} attributs · score dérivé</p>
                  </div>
                  <span className="attribute-mark" aria-hidden="true">↗</span>
                </header>
                <div className="attribute-fields">
                  {config.cols.map((column) => (
                    <label className="attribute-field" key={column}>
                      <span>{LABELS[column] || humanize(column)}</span>
                      <input
                        name={column}
                        type="number"
                        min="0"
                        max="99"
                        step="1"
                        required
                        autoComplete="off"
                        value={attributes[column] ?? ""}
                        onChange={(event) => {
                          const value = event.target.value;
                          setAttributes((current) => ({ ...current, [column]: value }));
                        }}
                        aria-label={`${LABELS[column] || humanize(column)}, note sur 99`}
                        placeholder="—"
                      />
                    </label>
                  ))}
                </div>
                <footer className="derived-preview">
                  <span>MOYENNE DÉRIVÉE</span>
                  <strong>{preview.average == null ? "—" : preview.average.toFixed(0)}<small> / 99</small></strong>
                  <i>{preview.count}/{preview.total}</i>
                </footer>
              </section>
            );
          })}
        </div>

        <div className="evaluate-bar">
          <p><b>Le calcul se fait en 3 temps</b><span>Attributs → percentiles du poste → règles floues</span></p>
          <button className="btn evaluate-btn" type="submit" disabled={busy}>
            {busy ? "Analyse en cours…" : <>{result ? "Relancer l’analyse" : "Lancer l’analyse"} <span aria-hidden="true">↗</span></>}
          </button>
        </div>
        {profileChanged && (
          <div className="banner" role="status">Les règles du profil ont changé. Relance l’analyse pour mettre à jour ce joueur.</div>
        )}
        {error && <div className="banner error" role="alert">{error}</div>}
        <p className="live-status" aria-live="polite">
          {busy ? "Nouvelle analyse en cours." : result ? `${result.name}, score ${Math.round(result.score)}, ${result.verdict}.` : ""}
        </p>
      </form>

      {result && (
        <section
          className={`analysis-board${busy ? " is-updating" : ""}`}
          key={runId}
          ref={reportRef}
        >
          <header className="analysis-header">
            <div>
              <span className="lab-kicker dark-kicker">RAPPORT DE COMPATIBILITÉ · {profile.groupe || "MOC"}</span>
              <h2>{result.name}</h2>
            </div>
            <span className="report-stamp">{busy ? "MISE À JOUR…" : `ANALYSE ${updatedAt}`}</span>
          </header>

          <div className="analysis-overview">
            <div className={`verdict-card${result.is_good ? " positive" : " cautious"}`}>
              <span className="verdict-eyebrow">INDICE D’ADÉQUATION</span>
              <ScoreRing score={result.score} verdict={result.verdict} isGood={result.is_good} />
              <strong className="verdict-label">{result.verdict}</strong>
              <p>{result.is_good
                ? "Le profil répond aux attentes du poste selon les règles sélectionnées."
                : "Le profil présente des écarts avec les attentes actuelles du poste."}</p>
            </div>
            <div className="radar-card">
              <div className="report-subhead">
                <div><span>01 / PROFIL</span><h3>Empreinte du joueur</h3></div>
                <small>Percentile parmi les {profile.groupe || "MOC"}</small>
              </div>
              <Radar categories={result.categories} />
              <div className="rating-strip">
                {Object.entries(result.ratings).map(([category, rating]) => (
                  <span key={category}><b>{category}</b>{rating}<small>/99</small></span>
                ))}
              </div>
            </div>
          </div>

          <div className="analysis-lower">
            <section className="diagnosis-card">
              <div className="report-subhead">
                <div><span>02 / DIAGNOSTIC</span><h3>Forces du prospect</h3></div>
              </div>
              <div className="strength-list">
                {strengths.map(([category, value], index) => (
                  <div className="strength-row" key={category}>
                    <span className="strength-rank">{String(index + 1).padStart(2, "0")}</span>
                    <b>{category}</b>
                    <div className="strength-track"><i style={{ "--strength": `${value}%` }} /></div>
                    <strong>{Math.round(value)}<small>%</small></strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="rules-card">
              <div className="report-subhead">
                <div><span>03 / MOTEUR FLOU</span><h3>Pourquoi ce verdict ?</h3></div>
                <span className="rule-count">{result.rules.length} règle{result.rules.length === 1 ? "" : "s"}</span>
              </div>
              {topRule && (
                <div className="dominant-rule">
                  <span>RÈGLE DOMINANTE · {topRule.id}</span>
                  <strong>{topRule.text}</strong>
                  <div><i style={{ "--strength": `${topRule.strength * 100}%` }} /><b>{Math.round(topRule.strength * 100)} %</b></div>
                </div>
              )}
              {result.rules.length > 1 && (
                <ol className="rule-trail">
                  {result.rules.slice(1).map((rule) => (
                    <li key={rule.id}>
                      <span>{rule.id}</span><b>{rule.text}</b>
                      <i>{Math.round(rule.strength * 100)} %</i>
                    </li>
                  ))}
                </ol>
              )}
              {!result.rules.length && <p className="muted">Aucune règle ne s’est déclenchée avec une force significative. Vérifie les attributs ou ajuste le profil client.</p>}
            </section>
          </div>
          <section className="ai-insight">
            <div>
              <span className="lab-kicker dark-kicker">ANALYSE COMPLÉMENTAIRE · GROQ</span>
              <h3>Le regard du scout IA</h3>
              <p>L’IA explique le résultat calculé et les règles déclenchées. Le verdict reste celui du moteur de scouting.</p>
            </div>
            <button className="btn evaluate-btn" type="button" onClick={explainWithAi} disabled={aiBusy}>
              {aiBusy ? "Analyse IA en cours…" : "Générer l’explication"}
            </button>
            {aiError && <div className="banner error" role="alert">{aiError}</div>}
            {aiExplanation && <p className="ai-explanation">{aiExplanation}</p>}
          </section>
          <footer className="report-footnote">
            Résultat indicatif, calculé par comparaison aux joueurs du poste et aux règles du profil. Les notes d’entrée sont des attributs de jeu.
          </footer>
        </section>
      )}
    </div>
  );
}
