-- Run after schema.sql in the SAME write transaction. Keep source tables intact.
INSERT INTO app_settings (id, genres_for_filters_json)
SELECT 'settings:default', genres_for_filters_json FROM settings WHERE id = 1;

INSERT INTO auth_credentials SELECT id, secret_key FROM auth;

INSERT INTO qualities (id, value, title)
SELECT 'quality:' || hex(CAST(value AS BLOB)), value, title FROM quality_options;
-- Preserve values used by movies even if absent from today's settings catalog.
INSERT INTO qualities (id, value, title, is_active)
SELECT DISTINCT 'quality:' || hex(CAST(quality AS BLOB)), quality, quality, 0 FROM movies
WHERE quality NOT IN (SELECT value FROM qualities);

INSERT INTO extensions (id, value)
SELECT 'extension:' || hex(CAST(value AS BLOB)), value FROM extension_options;
INSERT INTO extensions (id, value, is_active)
SELECT DISTINCT 'extension:' || hex(CAST(extension AS BLOB)), extension, 0 FROM movies
WHERE extension NOT IN (SELECT value FROM extensions);

INSERT INTO settings_qualities
SELECT 'settings:default', q.id, o.is_default, o.sort_order
FROM quality_options o JOIN qualities q ON q.value = o.value;
INSERT INTO settings_extensions
SELECT 'settings:default', e.id, o.is_default, o.sort_order
FROM extension_options o JOIN extensions e ON e.value = o.value;

INSERT INTO titles (
  id, kind, kp_id, name, en_name, description, age_rating, rating, movie_length,
  poster_url, compact_poster_url, backdrop_url, countries_json, genres_json,
  director_json, actors_json, year_json, sequels_and_prequels_json, similar_movies_json
)
SELECT id, CASE WHEN is_series = 1 THEN 'series' ELSE 'movie' END,
  CAST(kp_id AS TEXT), name, en_name, description, age_rating, rating, movie_length,
  poster_url, compact_poster_url, backdrop_url, countries_json, genres_json,
  director_json, actors_json, year_json, sequels_and_prequels_json, similar_movies_json
FROM movies;

INSERT INTO genres (id, value)
SELECT DISTINCT 'genre:' || hex(CAST(j.value AS BLOB)), j.value
FROM movies m, json_each(m.genres_json) j WHERE j.type = 'text';
INSERT INTO title_genres
SELECT DISTINCT m.id, g.id FROM movies m, json_each(m.genres_json) j
JOIN genres g ON g.value = j.value WHERE j.type = 'text';

INSERT INTO movie_details (title_id) SELECT id FROM titles WHERE kind = 'movie';
-- Do not infer start/end dates, production status, or season counts from year_json.
INSERT INTO series_details (title_id) SELECT id FROM titles WHERE kind = 'series';
INSERT INTO library_entries SELECT id, added_date FROM movies;
INSERT INTO legacy_movie_values SELECT id, is_series, kp_id FROM movies;
INSERT INTO title_formats
SELECT m.id, q.id, e.id FROM movies m
JOIN qualities q ON q.value = m.quality JOIN extensions e ON e.value = m.extension;

INSERT INTO catalog_migrations VALUES ('catalog-v3', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
