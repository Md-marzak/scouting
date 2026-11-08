# Scouting flou : milieux offensifs (MOC)

Application de scouting football en logique floue, basée sur scikit-fuzzy. Le client saisit ses critères avec leurs unités
(vitesse en km/h, âge, taille, valeur en M€, notes) et règle lui-même les règles floues du poste.
Il peut aussi entrer les notes moyennes d'un joueur par catégorie pour obtenir une évaluation expliquée
de son adéquation au poste.

```
backend/   FastAPI + moteur flou (fuzzy_engine.py) + conversion d'unités (needs.py)
frontend/  React (Vite) : page « Besoin client » + éditeur de « Règles du client »
```

## 1. Données

1. Télécharge sur Kaggle « EA Sports FC 24 Complete Player Dataset » (stefanoleone992), fichier `male_players.csv`.
2. Place-le dans `backend/data/`, puis :

```powershell
cd backend
pip install -r requirements.txt
python prepare_data.py          # crée data/players_all.csv (tous les postes)
```

Pour tester sans Kaggle : `python make_demo_data.py` (600 joueurs fictifs, à ne pas utiliser pour le rendu).

## 2. Lancer

```powershell
# terminal 1
cd backend
uvicorn main:app --reload --port 8000

# terminal 2
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Pour la suggestion de règles par IA (optionnel, API gratuite Groq) :
`$env:GROQ_API_KEY="ta_cle"` avant de lancer uvicorn. Ne mets jamais la clé dans le code ni sur GitHub.

## 3. Comment ça marche

1. **Catégorie** (Vitesse, Tir, Passe, Dribbles, Défense, Physique) = percentile moyen de ses attributs de la carte.
2. **Fuzzification** : Faible / Moyen / Élevé, seuils calculés sur les quantiles des joueurs du poste (réglables à la main).
3. **Règles du poste** (JSON, modifiables) : SI Passe = Élevé ET Dribbles = Élevé ALORS Excellent, etc.
   Ensembles d'appartenance et défuzzification par centroïde avec scikit-fuzzy, inférence de Mamdani.
4. **Besoin client** : chaque critère saisi (ex. vitesse ≥ 32 km/h) donne un degré de satisfaction flou entre 0 et 1,
   avec une tolérance (ex. 2 km/h). Combinaison : moyenne pondérée ou ET flou pondéré (Dubois-Prade).
5. **Compatibilité** = mélange du besoin client et du score des règles du poste (curseur).
6. **Mon joueur** : saisis le nom et les notes moyennes (0–99) pour Vitesse, Tir, Passe, Dribbles,
   Défense et Physique. L'application compare chaque catégorie aux milieux offensifs de référence,
   applique les règles du profil sélectionné et affiche le verdict ainsi que les règles déclenchées.

## 4. Limites à connaître (à écrire dans le rapport)

- Les notes viennent d'un jeu vidéo, pas de statistiques de matchs réels.
- La conversion note vers km/h (`needs.py`, liste `calib`) est une **hypothèse** : il n'existe pas de table officielle.
  Justifie-la (par exemple avec des vitesses de pointe mesurées connues) ou ajuste les points.
- Seul le poste MOC est branché (`GROUPE = "MOC"` dans `main.py`). Un autre poste = un autre profil JSON
  dans `backend/profiles/` + un autre `GROUPE`.
- Les joueurs ayant le même verdict flou sont départagés par la moyenne de leurs catégories.
- Non testés ici : l'appel à l'API Groq et les vraies données Kaggle.
