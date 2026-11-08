"""Transforme data/male_players.csv (Kaggle, EA Sports FC 24) en data/players_all.csv (tous les postes)."""
import pandas as pd

SRC, DST = "data/male_players.csv", "data/players_all.csv"

# Structure de la carte FC 24 : catégorie -> {nom sur la carte: colonne du dataset}
CARD = {
    "Vitesse": {"Accélération": "movement_acceleration", "Vitesse": "movement_sprint_speed"},
    "Tir": {"Placement off.": "mentality_positioning", "Finition": "attacking_finishing",
            "Puiss. tir": "power_shot_power", "Tirs de loin": "power_long_shots",
            "Volées": "attacking_volleys", "Pénaltys": "mentality_penalties"},
    "Passe": {"Vista": "mentality_vision", "Centres": "attacking_crossing",
              "Précision CF": "skill_fk_accuracy", "Passes courtes": "attacking_short_passing",
              "Passes longues": "skill_long_passing", "Effet": "skill_curve"},
    "Dribbles": {"Agilité": "movement_agility", "Équilibre": "movement_balance",
                 "Réactivité": "movement_reactions", "Conduite balle": "skill_ball_control",
                 "Dribbles": "skill_dribbling", "Calme": "mentality_composure"},
    "Défense": {"Interceptions": "mentality_interceptions", "Précision tête": "attacking_heading_accuracy",
                "Lucidité déf.": "defending_marking_awareness", "Tacles debout": "defending_standing_tackle",
                "Tacles glissés": "defending_sliding_tackle"},
    "Physique": {"Détente": "power_jumping", "Endurance": "power_stamina",
                 "Force": "power_strength", "Agressivité": "mentality_aggression"},
}
GK_CARD = {"Plongeon": "goalkeeping_diving", "Jeu à la main": "goalkeeping_handling",
           "Jeu au pied": "goalkeeping_kicking", "Placement": "goalkeeping_positioning",
           "Réflexes": "goalkeeping_reflexes"}
META = ["player_id", "short_name", "age", "overall", "potential", "value_eur", "wage_eur", "height_cm",
        "weight_kg", "preferred_foot", "player_positions", "club_name", "nationality_name", "player_face_url"]
POSTES = {"GB": ["GK"], "DC": ["CB"], "LAT": ["LB", "RB", "LWB", "RWB"], "MDC": ["CDM"],
          "MC": ["CM"], "MOC": ["CAM"], "AIL": ["LW", "RW", "LM", "RM"], "BU": ["ST", "CF"]}
POS2GRP = {p: g for g, ps in POSTES.items() for p in ps}

df = pd.read_csv(SRC, low_memory=False)
if "fifa_version" in df.columns:          # garder la version la plus récente du jeu
    df = df[df["fifa_version"] == df["fifa_version"].max()]
if "fifa_update" in df.columns:
    df = df[df["fifa_update"] == df["fifa_update"].max()]
if "player_id" in df.columns:
    df = df.drop_duplicates("player_id")

outfield = [c for cat in CARD.values() for c in cat.values()]
gk = list(GK_CARD.values())
meta = [c for c in META if c in df.columns]

df["pos_main"] = df["player_positions"].str.split(",").str[0].str.strip()
df["groupe"] = df["pos_main"].map(POS2GRP)
df = df.dropna(subset=["groupe"])
res = pd.concat([df[df.groupe == "GB"].dropna(subset=gk),
                 df[df.groupe != "GB"].dropna(subset=outfield)])[meta + ["pos_main", "groupe"] + outfield + gk]
print(res.groupby("groupe").size())
res.to_csv(DST, index=False)
print("Écrit :", DST)
