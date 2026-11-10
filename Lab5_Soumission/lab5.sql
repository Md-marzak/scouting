-- LAB 5 — Segmentation, partitionnement et organisation des traces GPS
-- PostgreSQL + PostGIS ; geometries du reseau en EPSG:32629 (metres).
--
-- Avant execution :
--   1. Se connecter a la base ReseauElectriqueSIG qui contient
--      public.sous_stations et public.lignes_haute_tension.
--   2. Executer avec psql, en dehors de pgAdmin :
--      psql -h localhost -p 5433 -U postgres -d ReseauElectriqueSIG -v ON_ERROR_STOP=1 -a -f lab5.sql
--   3. Ce script cree un schema dedie et ne supprime pas les tables sources.
--      Si le schema ci-dessous existe deja, choisir un autre nom dans CREATE SCHEMA
--      et dans SET search_path avant une nouvelle execution.
--   4. La generation produit 1 008 000 positions (200 vehicules, intervalle
--      de 2 minutes, 7 jours). Prevoir de l'espace disque.
--
-- Les requetes de mesure sont identifiees par Q1 / Q2. Pour chaque plan,
-- conserver la seconde execution (cache chaud), comme demande dans le sujet.

\timing on
\pset pager off
\set ON_ERROR_STOP on

CREATE SCHEMA lab5_soumission;
SET search_path TO lab5_soumission, public;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    RAISE EXCEPTION 'PostGIS doit etre installe dans cette base.';
  END IF;
  IF to_regclass('public.sous_stations') IS NULL
     OR to_regclass('public.lignes_haute_tension') IS NULL THEN
    RAISE EXCEPTION 'Tables sources attendues : public.sous_stations et public.lignes_haute_tension.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.sous_stations WHERE id = 1) THEN
    RAISE EXCEPTION 'La sous-station id=1 est absente.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.lignes_haute_tension WHERE ogc_fid = 1) THEN
    RAISE EXCEPTION 'La ligne haute tension ogc_fid=1 est absente.';
  END IF;
END $$;

CREATE TABLE resultats (
  cle text PRIMARY KEY,
  valeur text NOT NULL
);

-- =====================================================================
-- TASK 1 — Jeu de donnees de reference, index et requetes initiales
-- =====================================================================

\echo 'TASK 1.1 - Emprise et sous-stations'
SELECT ST_Extent(geom) AS emprise_reseau
FROM public.lignes_haute_tension;

SELECT id, nom, ST_SRID(geom) AS srid
FROM public.sous_stations
ORDER BY id;

\echo 'TASK 1.2 - Generation des positions'
SELECT setseed(0.20261109);

CREATE OR REPLACE FUNCTION generer_positions(debut timestamp, nb_pas integer)
RETURNS TABLE (
  id bigint,
  vehicule_id integer,
  date timestamp,
  geom geometry(Point, 32629)
)
LANGUAGE sql
VOLATILE
AS $fonction$
  WITH emprise AS (
    SELECT ST_Extent(l.geom) AS boite
    FROM public.lignes_haute_tension AS l
  ),
  postes AS (
    SELECT array_agg(s.geom ORDER BY s.id) AS geometries, count(*) AS nombre
    FROM public.sous_stations AS s
  )
  SELECT
    (extract(epoch FROM temps.instant)::bigint / 120) * 1000 + flotte.numero,
    flotte.numero,
    temps.instant,
    (
      CASE WHEN hasard.proche_poste THEN
        ST_Translate(
          ST_PointOnSurface(postes.geometries[
            1 + ((flotte.numero - 1) % postes.nombre)::integer
          ]),
          (hasard.dx - 0.5) * 4000,
          (hasard.dy - 0.5) * 4000
        )
      ELSE
        ST_SetSRID(
          ST_MakePoint(
            ST_XMin(emprise.boite) + hasard.dx * (ST_XMax(emprise.boite) - ST_XMin(emprise.boite)),
            ST_YMin(emprise.boite) + hasard.dy * (ST_YMax(emprise.boite) - ST_YMin(emprise.boite))
          ),
          32629
        )
      END
    )::geometry(Point, 32629)
  FROM generate_series(0, nb_pas - 1) AS pas(n)
  CROSS JOIN LATERAL (
    SELECT debut + pas.n * interval '2 minutes' AS instant
  ) AS temps
  CROSS JOIN generate_series(1, 200) AS flotte(numero)
  CROSS JOIN emprise
  CROSS JOIN postes
  CROSS JOIN LATERAL (
    SELECT random() < 0.7 AS proche_poste, random() AS dx, random() AS dy
  ) AS hasard
  ORDER BY temps.instant, flotte.numero
$fonction$;

CREATE TABLE gps_positions AS
SELECT *
FROM generer_positions(timestamp '2026-10-27 00:00', 7 * 720)
ORDER BY date, vehicule_id;

ALTER TABLE gps_positions
  ADD CONSTRAINT gps_positions_pk PRIMARY KEY (id);

\echo 'Controle du volume et de la periode generee'
SELECT count(*) AS nombre_positions, min(date) AS premiere_position,
       max(date) AS derniere_position
FROM gps_positions;

INSERT INTO resultats (cle, valeur)
SELECT 'volume_initial', count(*)::text FROM gps_positions;

CREATE INDEX gps_positions_geom_gix ON gps_positions USING GIST (geom);
CREATE INDEX gps_positions_date_idx ON gps_positions (date);
VACUUM ANALYZE gps_positions;

\echo 'Tailles initiales : table et index'
SELECT
  pg_size_pretty(pg_relation_size('gps_positions')) AS table,
  pg_size_pretty(pg_indexes_size('gps_positions')) AS index,
  pg_size_pretty(pg_total_relation_size('gps_positions')) AS total;

INSERT INTO resultats VALUES
  ('taille_table_initiale', pg_size_pretty(pg_relation_size('gps_positions'))),
  ('taille_index_initiale', pg_size_pretty(pg_indexes_size('gps_positions')));

\echo 'Q1 - positions du 01/11 a moins de 500 m de la sous-station 1'
SELECT count(*) AS positions_q1
FROM gps_positions AS p
JOIN public.sous_stations AS s
  ON ST_DWithin(p.geom, s.geom, 500)
WHERE s.id = 1
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

\echo 'Q1 - plan, execution 1'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM gps_positions AS p
JOIN public.sous_stations AS s
  ON ST_DWithin(p.geom, s.geom, 500)
WHERE s.id = 1
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

\echo 'Q1 - plan, execution 2 (mesure a reporter)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM gps_positions AS p
JOIN public.sous_stations AS s
  ON ST_DWithin(p.geom, s.geom, 500)
WHERE s.id = 1
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

INSERT INTO resultats
SELECT 'q1_reference', count(*)::text
FROM gps_positions AS p
JOIN public.sous_stations AS s ON ST_DWithin(p.geom, s.geom, 500)
WHERE s.id = 1
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

\echo 'Q2 - vehicules a moins de 2 km de l incident entre 23h et minuit'
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension
  WHERE ogc_fid = 1
)
SELECT DISTINCT p.vehicule_id
FROM gps_positions AS p
CROSS JOIN incident AS i
WHERE p.date >= timestamp '2026-11-02 23:00'
  AND p.date < timestamp '2026-11-03 00:00'
  AND ST_DWithin(p.geom, i.point, 2000)
ORDER BY p.vehicule_id;

\echo 'Q2 - plan, execution 1'
EXPLAIN (ANALYZE, BUFFERS)
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension
  WHERE ogc_fid = 1
)
SELECT DISTINCT p.vehicule_id
FROM gps_positions AS p
CROSS JOIN incident AS i
WHERE p.date >= timestamp '2026-11-02 23:00'
  AND p.date < timestamp '2026-11-03 00:00'
  AND ST_DWithin(p.geom, i.point, 2000);

\echo 'Q2 - plan, execution 2 (mesure a reporter)'
EXPLAIN (ANALYZE, BUFFERS)
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension
  WHERE ogc_fid = 1
)
SELECT DISTINCT p.vehicule_id
FROM gps_positions AS p
CROSS JOIN incident AS i
WHERE p.date >= timestamp '2026-11-02 23:00'
  AND p.date < timestamp '2026-11-03 00:00'
  AND ST_DWithin(p.geom, i.point, 2000);

INSERT INTO resultats
SELECT 'q2_reference', count(DISTINCT p.vehicule_id)::text
FROM gps_positions AS p
CROSS JOIN (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension
  WHERE ogc_fid = 1
) AS i
WHERE p.date >= timestamp '2026-11-02 23:00'
  AND p.date < timestamp '2026-11-03 00:00'
  AND ST_DWithin(p.geom, i.point, 2000);

-- =====================================================================
-- TASK 2 — Decoupage logique de l espace en trois bandes
-- =====================================================================

ALTER TABLE gps_positions ADD COLUMN zone_id smallint;

UPDATE gps_positions AS p
SET zone_id = CASE
  WHEN ST_Y(p.geom) >= limites.y_nord THEN 3
  WHEN ST_Y(p.geom) >= limites.y_centre THEN 2
  ELSE 1
END
FROM (
  SELECT
    ST_YMin(b) + 2 * (ST_YMax(b) - ST_YMin(b)) / 3 AS y_nord,
    ST_YMin(b) +     (ST_YMax(b) - ST_YMin(b)) / 3 AS y_centre
  FROM (SELECT ST_Extent(geom) AS b FROM gps_positions) AS e
) AS limites;

ALTER TABLE gps_positions ALTER COLUMN zone_id SET NOT NULL;

\echo 'Effectifs par bande et par jour'
SELECT zone_id, count(*) AS positions
FROM gps_positions
GROUP BY zone_id
ORDER BY zone_id;

SELECT zone_id, date::date AS jour, count(*) AS positions
FROM gps_positions
GROUP BY zone_id, date::date
ORDER BY zone_id, jour;

CREATE INDEX gps_positions_zone_date_idx ON gps_positions (zone_id, date);
ANALYZE gps_positions;

CREATE TABLE zone_station_1 AS
WITH limites AS (
  SELECT
    ST_YMin(b) +     (ST_YMax(b) - ST_YMin(b)) / 3 AS y_centre,
    ST_YMin(b) + 2 * (ST_YMax(b) - ST_YMin(b)) / 3 AS y_nord
  FROM (SELECT ST_Extent(geom) AS b FROM gps_positions) AS e
),
station AS (
  SELECT id, geom, ST_Y(ST_PointOnSurface(geom)) AS y
  FROM public.sous_stations
  WHERE id = 1
)
SELECT station.id, station.geom,
       CASE WHEN station.y >= limites.y_nord THEN 3
            WHEN station.y >= limites.y_centre THEN 2 ELSE 1 END::smallint AS zone_id,
       round(LEAST(abs(station.y - limites.y_centre),
                   abs(station.y - limites.y_nord))::numeric, 2) AS distance_frontiere_m
FROM station CROSS JOIN limites;

SELECT zone_id AS zone_station_1, distance_frontiere_m
FROM zone_station_1;

\echo 'Q1 avec filtre logique sur la zone de la sous-station'
SELECT count(*) AS positions_q1_zone
FROM gps_positions AS p
JOIN zone_station_1 AS s ON ST_DWithin(p.geom, s.geom, 500)
WHERE p.zone_id = s.zone_id
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

\echo 'Q1-zone - plan, execution 1'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM gps_positions AS p
JOIN zone_station_1 AS s ON ST_DWithin(p.geom, s.geom, 500)
WHERE p.zone_id = s.zone_id
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

\echo 'Q1-zone - plan, execution 2 (comparer au Q1 de reference)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM gps_positions AS p
JOIN zone_station_1 AS s ON ST_DWithin(p.geom, s.geom, 500)
WHERE p.zone_id = s.zone_id
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

-- =====================================================================
-- TASK 3 — Partitionnement physique par jour
-- =====================================================================

CREATE TABLE gps_part (
  id bigint NOT NULL,
  vehicule_id integer NOT NULL,
  date timestamp NOT NULL,
  geom geometry(Point, 32629) NOT NULL,
  PRIMARY KEY (id, date)
) PARTITION BY RANGE (date);

DO $$
DECLARE jour date;
BEGIN
  FOR jour IN
    SELECT generate_series(date '2026-10-27', date '2026-11-02',
                           interval '1 day')::date
  LOOP
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF gps_part FOR VALUES FROM (%L) TO (%L)',
      'gps_' || to_char(jour, 'YYYY_MM_DD'),
      jour::timestamp,
      (jour + 1)::timestamp
    );
  END LOOP;
END $$;

CREATE TABLE gps_default PARTITION OF gps_part DEFAULT;

INSERT INTO gps_part (id, vehicule_id, date, geom)
SELECT id, vehicule_id, date, geom
FROM gps_positions
ORDER BY date, vehicule_id;

CREATE INDEX gps_part_geom_gix ON gps_part USING GIST (geom);
CREATE INDEX gps_part_date_idx ON gps_part (date);
VACUUM ANALYZE gps_part;

\echo 'Repartition des enregistrements par partition'
SELECT tableoid::regclass AS partition, count(*) AS positions
FROM gps_part
GROUP BY tableoid
ORDER BY tableoid::regclass::text;

\echo 'Q1 sur la table partitionnee (les plans doivent montrer l elimination de partitions)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM gps_part AS p
JOIN public.sous_stations AS s ON ST_DWithin(p.geom, s.geom, 500)
WHERE s.id = 1
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM gps_part AS p
JOIN public.sous_stations AS s ON ST_DWithin(p.geom, s.geom, 500)
WHERE s.id = 1
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

\echo 'Q1 sans predicat de date (aucune partition journaliere ne peut etre eliminee)'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM gps_part AS p
JOIN public.sous_stations AS s ON ST_DWithin(p.geom, s.geom, 500)
WHERE s.id = 1;

EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM gps_part AS p
JOIN public.sous_stations AS s ON ST_DWithin(p.geom, s.geom, 500)
WHERE s.id = 1;

\echo 'Q2 avec borne temporelle dynamique (observer Subplans Removed)'
EXPLAIN (ANALYZE, BUFFERS)
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension WHERE ogc_fid = 1
)
SELECT DISTINCT p.vehicule_id
FROM gps_part AS p
CROSS JOIN incident AS i
WHERE p.date >= (SELECT max(date) FROM gps_part) - interval '1 hour'
  AND ST_DWithin(p.geom, i.point, 2000);

\echo 'Q2 dynamique - seconde execution'
EXPLAIN (ANALYZE, BUFFERS)
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension WHERE ogc_fid = 1
)
SELECT DISTINCT p.vehicule_id
FROM gps_part AS p
CROSS JOIN incident AS i
WHERE p.date >= (SELECT max(date) FROM gps_part) - interval '1 hour'
  AND ST_DWithin(p.geom, i.point, 2000);

-- Une journee supplementaire : meme lot insere dans les deux organisations.
CREATE TABLE gps_2026_11_03 PARTITION OF gps_part
  FOR VALUES FROM ('2026-11-03') TO ('2026-11-04');

CREATE TEMP TABLE positions_jour_03 AS
SELECT * FROM generer_positions(timestamp '2026-11-03 00:00', 720);

DO $$
DECLARE
  debut timestamptz;
  duree_ms numeric;
BEGIN
  debut := clock_timestamp();
  INSERT INTO gps_positions (id, vehicule_id, date, geom, zone_id)
  SELECT
    n.id, n.vehicule_id, n.date, n.geom,
    CASE WHEN ST_Y(n.geom) >= limites.y_nord THEN 3
         WHEN ST_Y(n.geom) >= limites.y_centre THEN 2 ELSE 1 END
  FROM positions_jour_03 AS n
  CROSS JOIN (
    SELECT
      ST_YMin(b) +     (ST_YMax(b) - ST_YMin(b)) / 3 AS y_centre,
      ST_YMin(b) + 2 * (ST_YMax(b) - ST_YMin(b)) / 3 AS y_nord
    FROM (SELECT ST_Extent(geom) AS b FROM gps_positions) AS e
  ) AS limites;
  duree_ms := extract(epoch FROM clock_timestamp() - debut) * 1000;
  INSERT INTO resultats VALUES ('insertion_table_ms', round(duree_ms, 1)::text);
  RAISE NOTICE 'Insertion dans gps_positions : % ms', round(duree_ms, 1);

  debut := clock_timestamp();
  INSERT INTO gps_part (id, vehicule_id, date, geom)
  SELECT id, vehicule_id, date, geom FROM positions_jour_03;
  duree_ms := extract(epoch FROM clock_timestamp() - debut) * 1000;
  INSERT INTO resultats VALUES ('insertion_partition_ms', round(duree_ms, 1)::text);
  RAISE NOTICE 'Insertion dans gps_part : % ms', round(duree_ms, 1);
END $$;

\echo 'Volume de la nouvelle partition'
SELECT count(*) AS positions_03_11 FROM gps_2026_11_03;

INSERT INTO resultats VALUES
  ('taille_table_apres_insertion', pg_size_pretty(pg_total_relation_size('gps_positions'))),
  ('taille_partition_apres_insertion', pg_size_pretty(pg_total_relation_size('gps_part')));

-- Suppression de la premiere journee : comparaison DELETE et retrait d une partition.
INSERT INTO resultats
SELECT 'taille_table_avant_purge', pg_size_pretty(pg_total_relation_size('gps_positions'));

DO $$
DECLARE debut timestamptz;
BEGIN
  debut := clock_timestamp();
  DELETE FROM gps_positions WHERE date < timestamp '2026-10-28';
  INSERT INTO resultats
  VALUES ('suppression_delete_ms',
          round(extract(epoch FROM clock_timestamp() - debut) * 1000, 1)::text);
END $$;

DO $$
DECLARE debut timestamptz;
BEGIN
  debut := clock_timestamp();
  DROP TABLE gps_2026_10_27;
  INSERT INTO resultats
  VALUES ('suppression_partition_ms',
          round(extract(epoch FROM clock_timestamp() - debut) * 1000, 1)::text);
END $$;

VACUUM ANALYZE gps_positions;
VACUUM ANALYZE gps_part;

INSERT INTO resultats
SELECT 'taille_table_apres_purge', pg_size_pretty(pg_total_relation_size('gps_positions'));

-- =====================================================================
-- TASK 4 — Tuilage carre de 2 km et GeoHash
-- =====================================================================

\echo 'Grille de 2 km sur les positions du 01/11'
CREATE TABLE grille_2km AS
SELECT g.i, g.j, g.geom
FROM ST_SquareGrid(
  2000,
  (SELECT ST_SetSRID(ST_Extent(geom)::geometry, 32629)
   FROM gps_2026_11_01)
) AS g;
CREATE INDEX grille_2km_geom_gix ON grille_2km USING GIST (geom);

SELECT count(*) AS nombre_tuiles FROM grille_2km;

\echo 'Nombre de positions reliees par intersection spatiale'
SELECT count(*) AS lignes_apres_jointure, count(DISTINCT p.id) AS positions_uniques
FROM gps_2026_11_01 AS p
JOIN grille_2km AS g ON ST_Intersects(p.geom, g.geom);

\echo 'Densite par cellule, attribution deterministe par floor'
CREATE TABLE densite_2km AS
SELECT
  floor(ST_X(geom) / 2000)::integer AS i,
  floor(ST_Y(geom) / 2000)::integer AS j,
  count(*) AS positions
FROM gps_2026_11_01
GROUP BY 1, 2;

SELECT count(*) AS tuiles_non_vides, min(positions) AS minimum,
       max(positions) AS maximum, round(avg(positions), 1) AS moyenne,
       round(stddev_pop(positions), 1) AS ecart_type
FROM densite_2km;

CREATE TABLE densite_2km_carte AS
SELECT d.i, d.j, d.positions, g.geom
FROM densite_2km AS d
JOIN grille_2km AS g USING (i, j);
CREATE INDEX densite_2km_carte_gix ON densite_2km_carte USING GIST (geom);

-- GeoHash calcule a l ecriture, precision 6 ; le prefixe 5 est utilise
-- comme prefiltre et ST_DWithin conserve la verification geometrique exacte.
ALTER TABLE gps_part ADD COLUMN geohash text
  GENERATED ALWAYS AS (ST_GeoHash(ST_Transform(geom, 4326), 6)) STORED;
CREATE INDEX gps_part_geohash_idx
  ON gps_part (geohash text_pattern_ops);
CREATE INDEX gps_part_geohash5_idx
  ON gps_part (left(geohash, 5));
VACUUM ANALYZE gps_part;

\echo 'Q2 avec seule la tuile GeoHash du point incident (risque de faux negatifs)'
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension WHERE ogc_fid = 1
),
tuile AS (
  SELECT ST_GeoHash(ST_Transform(point, 4326), 5) AS prefixe
  FROM incident
)
SELECT DISTINCT p.vehicule_id
FROM gps_part AS p
CROSS JOIN incident AS i
CROSS JOIN tuile AS t
WHERE p.date >= timestamp '2026-11-02 23:00'
  AND p.date < timestamp '2026-11-03 00:00'
  AND left(p.geohash, 5) = t.prefixe
  AND ST_DWithin(p.geom, i.point, 2000)
ORDER BY p.vehicule_id;

\echo 'Q2 avec les prefixes GeoHash des coins de l emprise de 2 km'
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension WHERE ogc_fid = 1
),
prefixes AS (
  SELECT DISTINCT ST_GeoHash(ST_Transform(c.geom, 4326), 5) AS prefixe
  FROM incident AS i
  CROSS JOIN LATERAL ST_DumpPoints(ST_Expand(i.point, 2000)) AS c
)
SELECT DISTINCT p.vehicule_id
FROM gps_part AS p
CROSS JOIN incident AS i
WHERE p.date >= timestamp '2026-11-02 23:00'
  AND p.date < timestamp '2026-11-03 00:00'
  AND left(p.geohash, 5) IN (SELECT prefixe FROM prefixes)
  AND ST_DWithin(p.geom, i.point, 2000)
ORDER BY p.vehicule_id;

\echo 'Q2 GeoHash - plan, execution 1'
EXPLAIN (ANALYZE, BUFFERS)
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension WHERE ogc_fid = 1
),
prefixes AS (
  SELECT DISTINCT ST_GeoHash(ST_Transform(c.geom, 4326), 5) AS prefixe
  FROM incident AS i
  CROSS JOIN LATERAL ST_DumpPoints(ST_Expand(i.point, 2000)) AS c
)
SELECT DISTINCT p.vehicule_id
FROM gps_part AS p
CROSS JOIN incident AS i
WHERE p.date >= timestamp '2026-11-02 23:00'
  AND p.date < timestamp '2026-11-03 00:00'
  AND left(p.geohash, 5) IN (SELECT prefixe FROM prefixes)
  AND ST_DWithin(p.geom, i.point, 2000);

\echo 'Q2 GeoHash - plan, execution 2 (mesure a reporter)'
EXPLAIN (ANALYZE, BUFFERS)
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension WHERE ogc_fid = 1
),
prefixes AS (
  SELECT DISTINCT ST_GeoHash(ST_Transform(c.geom, 4326), 5) AS prefixe
  FROM incident AS i
  CROSS JOIN LATERAL ST_DumpPoints(ST_Expand(i.point, 2000)) AS c
)
SELECT DISTINCT p.vehicule_id
FROM gps_part AS p
CROSS JOIN incident AS i
WHERE p.date >= timestamp '2026-11-02 23:00'
  AND p.date < timestamp '2026-11-03 00:00'
  AND left(p.geohash, 5) IN (SELECT prefixe FROM prefixes)
  AND ST_DWithin(p.geom, i.point, 2000);

\echo 'Comparer les vehicules de Q2 de reference et ceux retrouves avec les prefixes'
WITH reference AS (
  SELECT DISTINCT p.vehicule_id
  FROM gps_part AS p
  CROSS JOIN (
    SELECT ST_PointOnSurface(geom) AS point
    FROM public.lignes_haute_tension WHERE ogc_fid = 1
  ) AS i
  WHERE p.date >= timestamp '2026-11-02 23:00'
    AND p.date < timestamp '2026-11-03 00:00'
    AND ST_DWithin(p.geom, i.point, 2000)
),
prefixes AS (
  SELECT DISTINCT ST_GeoHash(ST_Transform(c.geom, 4326), 5) AS prefixe
  FROM (
    SELECT ST_PointOnSurface(geom) AS point
    FROM public.lignes_haute_tension WHERE ogc_fid = 1
  ) AS i
  CROSS JOIN LATERAL ST_DumpPoints(ST_Expand(i.point, 2000)) AS c
),
optimisee AS (
  SELECT DISTINCT p.vehicule_id
  FROM gps_part AS p
  CROSS JOIN (
    SELECT ST_PointOnSurface(geom) AS point
    FROM public.lignes_haute_tension WHERE ogc_fid = 1
  ) AS i
  WHERE p.date >= timestamp '2026-11-02 23:00'
    AND p.date < timestamp '2026-11-03 00:00'
    AND left(p.geohash, 5) IN (SELECT prefixe FROM prefixes)
    AND ST_DWithin(p.geom, i.point, 2000)
)
SELECT 'absents_apres_prefiltre' AS ecart, count(*) AS nombre
FROM (SELECT vehicule_id FROM reference EXCEPT SELECT vehicule_id FROM optimisee) AS d
UNION ALL
SELECT 'supplementaires_apres_prefiltre', count(*)
FROM (SELECT vehicule_id FROM optimisee EXCEPT SELECT vehicule_id FROM reference) AS d;

-- =====================================================================
-- TASK 5 — Clustering : ordre physique et correlation statistique
-- =====================================================================

CREATE INDEX gps_2026_10_30_vehicule_date_idx
  ON gps_2026_10_30 (vehicule_id, date);
CREATE INDEX gps_2026_10_31_geohash_idx
  ON gps_2026_10_31 (geohash text_pattern_ops);
CREATE INDEX gps_2026_11_01_geom_gix
  ON gps_2026_11_01 USING GIST (geom);

ALTER TABLE gps_2026_11_01 ALTER COLUMN geom SET NOT NULL;

SELECT tablename, attname, round(correlation::numeric, 3) AS correlation_avant
FROM pg_stats
WHERE schemaname = 'lab5_soumission'
  AND tablename IN ('gps_2026_10_30', 'gps_2026_10_31', 'gps_2026_11_01')
  AND attname IN ('date', 'vehicule_id', 'geohash')
ORDER BY tablename, attname;

CLUSTER gps_2026_10_30 USING gps_2026_10_30_vehicule_date_idx;
CLUSTER gps_2026_10_31 USING gps_2026_10_31_geohash_idx;
CLUSTER gps_2026_11_01 USING gps_2026_11_01_geom_gix;

ANALYZE gps_2026_10_30;
ANALYZE gps_2026_10_31;
ANALYZE gps_2026_11_01;

SELECT tablename, attname, round(correlation::numeric, 3) AS correlation_apres
FROM pg_stats
WHERE schemaname = 'lab5_soumission'
  AND tablename IN ('gps_2026_10_30', 'gps_2026_10_31', 'gps_2026_11_01')
  AND attname IN ('date', 'vehicule_id', 'geohash')
ORDER BY tablename, attname;

\echo 'Q1 apres clustering'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM gps_part AS p
JOIN public.sous_stations AS s ON ST_DWithin(p.geom, s.geom, 500)
WHERE s.id = 1
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

\echo 'Q1 apres clustering - seconde execution'
EXPLAIN (ANALYZE, BUFFERS)
SELECT count(*)
FROM gps_part AS p
JOIN public.sous_stations AS s ON ST_DWithin(p.geom, s.geom, 500)
WHERE s.id = 1
  AND p.date >= timestamp '2026-11-01'
  AND p.date < timestamp '2026-11-02';

\echo 'Q2 apres clustering'
EXPLAIN (ANALYZE, BUFFERS)
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension WHERE ogc_fid = 1
)
SELECT DISTINCT p.vehicule_id
FROM gps_part AS p
CROSS JOIN incident AS i
WHERE p.date >= timestamp '2026-11-02 23:00'
  AND p.date < timestamp '2026-11-03 00:00'
  AND ST_DWithin(p.geom, i.point, 2000);

\echo 'Q2 apres clustering - seconde execution'
EXPLAIN (ANALYZE, BUFFERS)
WITH incident AS (
  SELECT ST_PointOnSurface(geom) AS point
  FROM public.lignes_haute_tension WHERE ogc_fid = 1
)
SELECT DISTINCT p.vehicule_id
FROM gps_part AS p
CROSS JOIN incident AS i
WHERE p.date >= timestamp '2026-11-02 23:00'
  AND p.date < timestamp '2026-11-03 00:00'
  AND ST_DWithin(p.geom, i.point, 2000);

-- =====================================================================
-- TASK 6 — Valeurs reproductibles pour preparer la synthese du rapport
-- Les temps et les lectures disque sont a relever dans les plans EXPLAIN.
-- =====================================================================

\echo 'Recapitulatif des valeurs calculees par le script'
SELECT cle, valeur
FROM resultats
ORDER BY cle;
