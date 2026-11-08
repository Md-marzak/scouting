import json
import os
import re
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from fuzzy_engine import FuzzyEngine, validate_profile
from needs import available, client_values, satisfaction, tolerance

BASE = Path(__file__).parent
DATA = BASE / "data" / "players_all.csv"
PROFILES = BASE / "profiles"
GROUPE = "MOC"  # poste couvert par cette version
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "openai/gpt-oss-20b"  # vérifie la liste des modèles sur console.groq.com
NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,40}$")

app = FastAPI(title="Scouting flou")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

if not DATA.exists():
    raise SystemExit("Fichier introuvable : backend/data/players_all.csv (voir README.md)")
POP = pd.read_csv(DATA, low_memory=False)
POP = POP[POP["groupe"] == GROUPE].reset_index(drop=True)


def clean(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        return None if np.isnan(v) else float(v)
    if isinstance(v, np.integer):
        return int(v)
    return v


@lru_cache(maxsize=32)
def run(profile_json: str):
    eng = FuzzyEngine(json.loads(profile_json), POP)
    vs, st = eng.score(POP)
    return eng, vs, st, vs.rank(pct=True) * 100


class SearchIn(BaseModel):
    profile: dict
    age_min: int | None = None
    age_max: int | None = None
    value_max: float | None = None  # en millions d'euros
    top: int = 20


def verdict(score, labels):
    """Niveau de sortie le plus proche du score (0-100) ; bon = moitié haute des niveaux."""
    n = len(labels)
    k = min(n - 1, max(0, int(round(score / 100 * (n - 1)))))
    return labels[k], k >= n // 2


def build_player(i, eng, vs, st, pct):
    row = POP.loc[i]
    return {
        "pid": int(i),
        "name": clean(row.get("short_name")), "club": clean(row.get("club_name")),
        "nation": clean(row.get("nationality_name")), "age": clean(row.get("age")),
        "overall": clean(row.get("overall")), "value_eur": clean(row.get("value_eur")),
        "face": clean(row.get("player_face_url")),
        "score": round(float(vs.loc[i, "Score"]), 1),
        "verdict": verdict(float(vs.loc[i, "Score"]), eng.p["output"])[0],
        "is_good": verdict(float(vs.loc[i, "Score"]), eng.p["output"])[1],
        "bars": {v: round(float(pct.loc[i, v])) for v in pct.columns if v != "Score"},
        "rules": [{"id": rid, "text": txt, "strength": round(x, 2)}
                  for rid, txt, x in eng.explain(st, i, 4)],
    }


@app.get("/api/meta")
def meta():
    return {"groupe": GROUPE, "n": int(len(POP)), "age": [int(POP["age"].min()), int(POP["age"].max())]}


@app.post("/api/search")
def search(body: SearchIn):
    try:
        eng, vs, st, pct = run(json.dumps(body.profile, sort_keys=True))
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400, f"Profil invalide : {e}")
    mask = pd.Series(True, index=POP.index)
    if body.age_min is not None:
        mask &= POP["age"] >= body.age_min
    if body.age_max is not None:
        mask &= POP["age"] <= body.age_max
    if body.value_max is not None and "value_eur" in POP:
        mask &= POP["value_eur"].fillna(np.inf) <= body.value_max * 1e6
    # départage des ex æquo : moyenne des variables (le score affiché reste inchangé)
    key = vs["Score"] + 0.001 * vs.drop(columns="Score").mean(axis=1)
    idx = key[mask].sort_values(ascending=False).head(max(1, min(body.top, 100))).index
    players = [build_player(i, eng, vs, st, pct) for i in idx]
    return {"players": players, "total": int(mask.sum()),
            "q_var": {v: [float(x) for x in q] for v, q in eng.q_var.items()}}


@app.get("/api/profiles")
def list_profiles():
    return sorted(p.stem for p in PROFILES.glob("*.json"))


@app.get("/api/profiles/{name}")
def get_profile(name: str):
    path = PROFILES / f"{name}.json"
    if not NAME_RE.match(name) or not path.exists():
        raise HTTPException(404, "Profil introuvable")
    return json.loads(path.read_text(encoding="utf-8"))


@app.put("/api/profiles/{name}")
def put_profile(name: str, profile: dict):
    if not NAME_RE.match(name):
        raise HTTPException(400, "Nom invalide : lettres, chiffres, - et _ uniquement (40 max)")
    try:
        validate_profile(profile, POP.columns)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400, f"Profil invalide : {e}")
    (PROFILES / f"{name}.json").write_text(
        json.dumps(profile, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"ok": True}


class SuggestIn(BaseModel):
    brief: str
    profile: dict


@app.post("/api/suggest-rules")
def suggest_rules(body: SuggestIn):
    key = os.getenv("GROQ_API_KEY")
    if not key:
        raise HTTPException(503, "Clé GROQ_API_KEY absente : définis-la avant de lancer le serveur.")
    variables = list(body.profile["variables"].keys())
    outputs = body.profile["output"]
    system = (
        "Tu es expert en scouting football et en logique floue. Transforme le besoin du client en règles floues. "
        "Réponds UNIQUEMENT par un tableau JSON de 6 à 12 règles, sans texte autour. "
        'Format d\'une règle : {"if":[{"var":NOM,"is":"low|mid|high"}],"op":"AND|OR","then":SORTIE,"weight":0.5 à 1}. '
        f"Variables autorisées : {variables}. Sorties autorisées : {outputs}. "
        "low = faible, mid = moyen, high = élevé. Couvre toutes les sorties."
    )
    try:
        r = requests.post(
            GROQ_URL, headers={"Authorization": f"Bearer {key}"}, timeout=40,
            json={"model": GROQ_MODEL, "temperature": 0.2,
                  "messages": [{"role": "system", "content": system},
                               {"role": "user", "content": body.brief}]})
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
        raw = json.loads(re.search(r"\[.*\]", content, re.S).group(0))
        rules = [{"id": f"R{i}",
                  "if": [{"var": c["var"], "is": c["is"]} for c in x["if"]],
                  "op": x.get("op", "AND"), "then": x["then"],
                  "weight": float(x.get("weight", 1.0))}
                 for i, x in enumerate(raw, 1)]
    except Exception as e:
        raise HTTPException(502, f"Le LLM n'a pas répondu correctement ({type(e).__name__}).")
    try:
        validate_profile({**body.profile, "rules": rules}, POP.columns)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(422, f"Règles proposées invalides : {e}")
    return {"rules": rules}


class CustomPlayerIn(BaseModel):
    name: str
    profile: dict
    attributes: dict[str, float]


@app.post("/api/evaluate-player")
def evaluate_player(body: CustomPlayerIn):
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Donne un nom au joueur.")
    if not np.isfinite(list(body.attributes.values())).all():
        raise HTTPException(400, "Les notes doivent être des nombres finis.")
    try:
        eng, _, _, _ = run(json.dumps(body.profile, sort_keys=True))
        expected = set(body.profile["variables"])
        supplied = set(body.attributes)
        if supplied != expected:
            missing = sorted(expected - supplied)
            extra = sorted(supplied - expected)
            details = []
            if missing:
                details.append(f"catégories manquantes : {', '.join(missing)}")
            if extra:
                details.append(f"catégories inconnues : {', '.join(extra)}")
            raise ValueError("; ".join(details))
        vs, strengths = eng.score_custom(body.attributes)
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400, f"Évaluation impossible : {e}")

    score = float(vs.loc[0, "Score"])
    label, is_good = verdict(score, eng.p["output"])
    return {
        "name": name,
        "score": round(score, 1),
        "verdict": label,
        "is_good": is_good,
        "categories": {
            key: round(float(value), 1)
            for key, value in vs.loc[0].drop("Score").items()
        },
        "rules": [
            {"id": rid, "text": text, "strength": round(strength, 2)}
            for rid, text, strength in eng.explain(strengths, 0, 6)
        ],
    }


# ---------- Besoin client : critères saisis avec leurs unités ----------
MODE_SYM = {"min": "≥", "max": "≤", "around": "≈"}


@app.get("/api/catalog")
def catalog():
    return [{k: v for k, v in c.items() if k not in ("calib", "col", "scale")}
            for c in available(POP.columns)]


class Need(BaseModel):
    id: str
    mode: str = "min"          # min = au moins, max = au plus, around = environ
    value: float               # dans l'unité du client (ex. 32 pour 32 km/h)
    importance: int = 3        # 1 à 5


class NeedsIn(BaseModel):
    profile: dict
    needs: list[Need] = []
    strict: bool = False       # False : moyenne pondérée ; True : ET flou pondéré (Dubois-Prade)
    rule_weight: float = 30    # part (%) du score venant des règles du profil de poste
    top: int = 20


@app.post("/api/needs-search")
def needs_search(body: NeedsIn):
    try:
        eng, vs, st, pct = run(json.dumps(body.profile, sort_keys=True))
    except (ValueError, KeyError, TypeError) as e:
        raise HTTPException(400, f"Profil invalide : {e}")
    cat = {c["id"]: c for c in available(POP.columns)}
    info, mus, ws = [], [], []
    for n in body.needs:
        c = cat.get(n.id)
        if c is None:
            raise HTTPException(400, f"Caractéristique inconnue : {n.id}")
        if n.mode not in MODE_SYM:
            raise HTTPException(400, f"Condition inconnue : {n.mode}")
        v = client_values(c, POP)
        mu = satisfaction(v, n.mode, n.value, tolerance(c, n.value))
        info.append((n, c, v, mu))
        mus.append(mu.values)
        ws.append(min(max(n.importance, 1), 5) / 5)
    if mus:
        M, W = np.stack(mus), np.array(ws)[:, None]
        sat = np.min(np.maximum(1 - W, M), axis=0) if body.strict else (W * M).sum(axis=0) / W.sum()
    else:
        sat = np.ones(len(POP))
    rw = min(max(body.rule_weight, 0), 100) / 100
    final = (1 - rw) * sat * 100 + rw * pct["Score"].values
    # départage : verdict des règles, puis moyenne des variables
    key = pd.Series(final + 0.001 * vs["Score"].values
                    + 0.0001 * vs.drop(columns="Score").mean(axis=1).values, index=POP.index)
    idx = key.sort_values(ascending=False).head(max(1, min(body.top, 100))).index
    players = []
    for i in idx:
        p = build_player(i, eng, vs, st, pct)
        p["final"] = round(float(final[i]), 1)
        p["verdict"], p["is_good"] = verdict(float(final[i]), eng.p["output"])
        p["needs_score"] = round(float(sat[i]) * 100)
        p["needs"] = []
        for n, c, v, mu in info:
            dec = 1 if c["step"] < 1 else 0
            val = v[i]
            p["needs"].append({
                "id": c["id"], "label": c["label"],
                "actual": "inconnu" if np.isnan(val) else f"{val:.{dec}f} {c['unit']}",
                "target": f"{MODE_SYM[n.mode]} {n.value:g} {c['unit']}",
                "sat": round(float(mu[i]) * 100),
            })
        players.append(p)
    return {"players": players, "total": int(len(POP)), "matching": int((sat >= 0.8).sum())}
