"""Catalogue des caractéristiques que le client peut saisir, avec leurs unités réelles.

- Les notes du jeu (0-99) sont affichées telles quelles ("note").
- La vitesse de pointe est convertie note <-> km/h par interpolation linéaire entre points de calibration.
  ATTENTION : ces points sont une HYPOTHÈSE de modélisation (le jeu ne publie pas de table officielle).
  À justifier dans le rapport (ex. en la comparant à des vitesses de pointe mesurées connues) et à ajuster ici.
"""
import numpy as np
import pandas as pd


def _rating(id_, label, col):
    return {"id": id_, "label": label, "col": col, "unit": "note", "min": 1, "max": 99,
            "step": 1, "tol": 8, "default": 75}


CATALOG = [
    {"id": "speed", "label": "Vitesse de pointe", "col": "movement_sprint_speed", "unit": "km/h",
     # [km/h, note du jeu] : points de calibration croissants
     "calib": [[22, 10], [27, 40], [30, 60], [33, 80], [36, 95], [37.5, 99]],
     "min": 20, "max": 38, "step": 0.5, "tol": 2, "default": 32,
     "note": "Conversion note du jeu vers km/h estimée (hypothèse modifiable dans needs.py)."},
    {"id": "age", "label": "Âge", "col": "age", "unit": "ans", "min": 16, "max": 40, "step": 1, "tol": 2, "default": 24},
    {"id": "height", "label": "Taille", "col": "height_cm", "unit": "cm", "min": 150, "max": 205, "step": 1, "tol": 4, "default": 178},
    {"id": "weight", "label": "Poids", "col": "weight_kg", "unit": "kg", "min": 50, "max": 110, "step": 1, "tol": 4, "default": 72},
    {"id": "value", "label": "Valeur marchande", "col": "value_eur", "scale": 1e-6, "unit": "M€",
     "min": 0, "max": 200, "step": 0.5, "tol_rel": 0.3, "tol": 1, "default": 10},
    _rating("overall", "Note globale", "overall"),
    _rating("finishing", "Finition", "attacking_finishing"),
    _rating("shot", "Puissance de tir", "power_shot_power"),
    _rating("positioning", "Placement offensif", "mentality_positioning"),
    _rating("dribbling", "Dribble", "skill_dribbling"),
    _rating("control", "Conduite de balle", "skill_ball_control"),
    _rating("vision", "Vision de jeu", "mentality_vision"),
    _rating("passing", "Passes courtes", "attacking_short_passing"),
    _rating("composure", "Calme", "mentality_composure"),
    _rating("accel", "Accélération", "movement_acceleration"),
    _rating("stamina", "Endurance", "power_stamina"),
    _rating("strength", "Force", "power_strength"),
]


def available(columns):
    return [c for c in CATALOG if c["col"] in columns]


def client_values(c, df):
    """Valeurs des joueurs exprimées dans l'unité du client (km/h, ans, cm, M€, note)."""
    x = df[c["col"]].astype(float)
    if "calib" in c:
        units = [p[0] for p in c["calib"]]
        ratings = [p[1] for p in c["calib"]]
        return pd.Series(np.interp(x, ratings, units), index=df.index).where(x.notna())
    return x * c.get("scale", 1.0)


def tolerance(c, target):
    return max(c["tol_rel"] * abs(target), c["tol"]) if "tol_rel" in c else c["tol"]


def satisfaction(v, mode, target, tol):
    """Degré (0 à 1) avec lequel la valeur v satisfait l'exigence du client."""
    if mode == "min":      # au moins X : 1 si v >= X, décroît jusqu'à 0 à X - tol
        m = (v - (target - tol)) / tol
    elif mode == "max":    # au plus X
        m = ((target + tol) - v) / tol
    else:                  # environ X : triangle de demi-largeur tol
        m = 1 - (v - target).abs() / tol
    return m.clip(0, 1).fillna(0)
