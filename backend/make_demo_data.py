"""Crée data/players_all.csv avec des joueurs fictifs, pour tester sans Kaggle."""
import numpy as np
import pandas as pd

rng = np.random.default_rng(7)
cols = ["movement_acceleration", "movement_sprint_speed", "mentality_positioning", "attacking_finishing",
        "power_shot_power", "power_long_shots", "attacking_volleys", "mentality_penalties", "mentality_vision",
        "attacking_crossing", "skill_fk_accuracy", "attacking_short_passing", "skill_long_passing", "skill_curve",
        "movement_agility", "movement_balance", "movement_reactions", "skill_ball_control", "skill_dribbling",
        "mentality_composure", "mentality_interceptions", "attacking_heading_accuracy",
        "defending_marking_awareness", "defending_standing_tackle", "defending_sliding_tackle",
        "power_jumping", "power_stamina", "power_strength", "mentality_aggression"]
n = 600
talent = rng.normal(0, 1, n)
df = pd.DataFrame({c: np.clip(62 + 9 * talent + rng.normal(0, 9, n), 20, 97).round() for c in cols})
df.insert(0, "short_name", [f"Joueur {i:03d}" for i in range(n)])
df.insert(1, "age", rng.integers(18, 36, n))
df.insert(2, "overall", np.clip(70 + 6 * talent + rng.normal(0, 2, n), 50, 92).round().astype(int))
df.insert(3, "value_eur", (np.exp(14 + 0.5 * talent + rng.normal(0, 0.6, n))).round(-4))
df.insert(4, "club_name", rng.choice(["FC Atlas", "Océan United", "Racing Mohammedia", "AS Corniche"], n))
df.insert(5, "nationality_name", rng.choice(["Maroc", "France", "Espagne", "Brésil"], n))
df.insert(6, "player_face_url", "")
df["height_cm"] = np.clip(rng.normal(177, 6, n), 160, 195).round()
df["weight_kg"] = np.clip(rng.normal(72, 6, n), 55, 95).round()
df["groupe"] = "MOC"
df.to_csv("data/players_all.csv", index=False)
print("data/players_all.csv créé :", len(df), "joueurs fictifs")
