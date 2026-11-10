import json
import numpy as np
import pandas as pd
import skfuzzy as fuzz

U = np.linspace(0, 100, 101)
LEVELS = ("low", "mid", "high")
LBL = {"low": "Faible", "mid": "Moyen", "high": "Élevé"}


def fuzzify(x, q25, q50, q75):
    x = np.asarray(x, dtype=float)
    high_end = q75 + 0.5 * (100 - q75)
    return {
        "low": fuzz.trapmf(x, [0, 0, q25, q50]),
        "mid": fuzz.trimf(x, [q25, q50, q75]),
        "high": fuzz.trapmf(x, [q50, high_end, 100, 100]),
    }


def output_sets(labels):
    """Ensembles triangulaires équidistants sur 0-100 (épaules aux extrémités)."""
    n = len(labels)
    step = 100 / (n - 1)
    sets = {}
    for i, lab in enumerate(labels):
        c = i * step
        mu = fuzz.trimf(U, [c - step, c, c + step])
        if i == 0:
            mu = np.where(U <= c, 1.0, mu)
        if i == n - 1:
            mu = np.where(U >= c, 1.0, mu)
        sets[lab] = mu
    return sets


def centroid(mu, fallback=50.0):
    result = []
    for membership in mu:
        result.append(fuzz.defuzz(U, membership, "centroid") if membership.any() else fallback)
    return np.asarray(result)


def load_profile(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def validate_profile(p, columns):
    errors = []
    for v, cfg in p["variables"].items():
        for c in cfg["cols"]:
            if c not in columns:
                errors.append(f"Colonne inconnue '{c}' (variable '{v}')")
        prm = cfg.get("params")
        if prm is not None and (len(prm) != 3 or not prm[0] <= prm[1] <= prm[2]):
            errors.append(f"Variable '{v}' : params doit être [q25, q50, q75] croissants")
    if len(p["output"]) < 2:
        errors.append("Il faut au moins 2 niveaux de sortie")
    if not p["rules"]:
        errors.append("Il faut au moins une règle")
    for i, r in enumerate(p["rules"], 1):
        rid = r.get("id", f"R{i}")
        if r.get("op", "AND") not in ("AND", "OR"):
            errors.append(f"{rid}: op doit être AND ou OR")
        if r["then"] not in p["output"]:
            errors.append(f"{rid}: sortie '{r['then']}' inconnue")
        if not r["if"]:
            errors.append(f"{rid}: au moins une condition")
        for c in r["if"]:
            if c["var"] not in p["variables"]:
                errors.append(f"{rid}: variable '{c['var']}' inconnue")
            if c["is"] not in LEVELS:
                errors.append(f"{rid}: 'is' doit être low, mid ou high")
    if errors:
        raise ValueError("\n".join(errors))


def rule_text(r):
    op = " ET " if r.get("op", "AND") == "AND" else " OU "
    cond = op.join(f"{c['var']} = {LBL[c['is']]}" for c in r["if"])
    return f"SI {cond} ALORS {r['then']}"


class FuzzyEngine:
    """Catégorie = percentile moyen de ses attributs (0-100), puis ensembles flous par quantiles."""

    def __init__(self, profile, population):
        validate_profile(profile, population.columns)
        self.p = profile
        self.out = output_sets(profile["output"])
        self.ref = {}
        for cfg in profile["variables"].values():
            for c in cfg["cols"]:
                if c not in self.ref:
                    self.ref[c] = np.sort(population[c].dropna().values.astype(float))
        pop_vs = self._variable_scores(population)
        self.q_var = {
            v: tuple(cfg["params"]) if cfg.get("params")
            else tuple(pop_vs[v].quantile([.25, .5, .75]))
            for v, cfg in profile["variables"].items()
        }

    def _pct(self, col, x):
        ref = self.ref[col]
        x = np.asarray(x, dtype=float)
        lo = np.searchsorted(ref, x, side="left")
        hi = np.searchsorted(ref, x, side="right")
        return (lo + hi) / 2 / len(ref) * 100

    def _variable_scores(self, df):
        res = {v: np.mean([self._pct(c, df[c].values) for c in cfg["cols"]], axis=0)
               for v, cfg in self.p["variables"].items()}
        return pd.DataFrame(res, index=df.index)

    def _infer(self, vs):
        """Applique les règles Mamdani aux scores des variables."""
        memb = {v: fuzzify(vs[v].values, *self.q_var[v]) for v in vs.columns}
        levels = {lab: np.zeros(len(vs)) for lab in self.p["output"]}
        strengths = {}
        for i, r in enumerate(self.p["rules"], 1):
            arr = np.stack([memb[c["var"]][c["is"]] for c in r["if"]])
            s = arr.min(axis=0) if r.get("op", "AND") == "AND" else arr.max(axis=0)
            s = np.clip(s * float(r.get("weight", 1.0)), 0, 1)
            strengths[r.get("id", f"R{i}")] = s
            levels[r["then"]] = np.maximum(levels[r["then"]], s)
        # When rules fire equally strongly, keep the highest consequent.
        labels = self.p["output"]
        for i, label in enumerate(labels[:-1]):
            higher = np.maximum.reduce([levels[other] for other in labels[i + 1:]])
            tied = (levels[label] > 0) & np.isclose(levels[label], higher)
            levels[label][tied] = 0
        mu = np.zeros((len(vs), len(U)))
        for lab, s in levels.items():
            mu = np.maximum(mu, np.minimum(s[:, None], self.out[lab][None, :]))
        out = vs.copy()
        out["Score"] = centroid(mu, 50.0)
        return out, pd.DataFrame(strengths, index=vs.index)

    def score(self, df):
        """Retourne (variables + Score, force de chaque règle)."""
        return self._infer(self._variable_scores(df))

    def score_custom(self, attributes):
        """Convertit les notes détaillées en percentiles de catégories."""
        expected = {
            col for cfg in self.p["variables"].values() for col in cfg["cols"]
        }
        supplied = set(attributes)
        if supplied != expected:
            missing = sorted(expected - supplied)
            extra = sorted(supplied - expected)
            details = []
            if missing:
                details.append(f"attributs manquants : {', '.join(missing)}")
            if extra:
                details.append(f"attributs inconnus : {', '.join(extra)}")
            raise ValueError("; ".join(details))

        values = {}
        for variable, cfg in self.p["variables"].items():
            values[variable] = []
            for col in cfg["cols"]:
                value = float(attributes[col])
                if not np.isfinite(value) or not 0 <= value <= 99:
                    raise ValueError(f"La note « {col} » doit être comprise entre 0 et 99")
                values[variable].append(float(self._pct(col, value)))
        return self._infer(pd.DataFrame([{
            variable: float(np.mean(scores)) for variable, scores in values.items()
        }])), {
            variable: float(np.mean([attributes[col] for col in cfg["cols"]]))
            for variable, cfg in self.p["variables"].items()
        }

    def explain(self, strengths, idx, top=5):
        """Règles les plus déclenchées pour le joueur d'index idx."""
        rules = {r.get("id", f"R{i}"): r for i, r in enumerate(self.p["rules"], 1)}
        s = strengths.loc[idx].sort_values(ascending=False)
        return [(rid, rule_text(rules[rid]), float(v)) for rid, v in s.head(top).items() if v > 0.05]
