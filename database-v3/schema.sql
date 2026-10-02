-- SQLite/libSQL. Enable foreign_keys on every connection before starting a transaction.
-- IDs are opaque application-generated text (UUID recommended), never display values.
CREATE TABLE catalog_migrations (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE app_settings (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'settings:default'),
  genres_for_filters_json TEXT NOT NULL CHECK (json_valid(genres_for_filters_json))
) STRICT, WITHOUT ROWID;

CREATE TABLE auth_credentials (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  secret_key TEXT NOT NULL
) STRICT, WITHOUT ROWID;

CREATE TABLE qualities (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  value TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
) STRICT, WITHOUT ROWID;

CREATE TABLE extensions (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  value TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
) STRICT, WITHOUT ROWID;

CREATE TABLE settings_qualities (
  settings_id TEXT NOT NULL REFERENCES app_settings(id) ON DELETE CASCADE,
  quality_id TEXT NOT NULL REFERENCES qualities(id) ON DELETE RESTRICT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (settings_id, quality_id)
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX settings_qualities_one_default ON settings_qualities(settings_id) WHERE is_default = 1;
CREATE INDEX settings_qualities_order ON settings_qualities(settings_id, sort_order, quality_id);
CREATE INDEX settings_qualities_quality ON settings_qualities(quality_id);

CREATE TABLE settings_extensions (
  settings_id TEXT NOT NULL REFERENCES app_settings(id) ON DELETE CASCADE,
  extension_id TEXT NOT NULL REFERENCES extensions(id) ON DELETE RESTRICT,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  PRIMARY KEY (settings_id, extension_id)
) STRICT, WITHOUT ROWID;
CREATE UNIQUE INDEX settings_extensions_one_default ON settings_extensions(settings_id) WHERE is_default = 1;
CREATE INDEX settings_extensions_order ON settings_extensions(settings_id, sort_order, extension_id);
CREATE INDEX settings_extensions_extension ON settings_extensions(extension_id);

CREATE TABLE titles (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('movie', 'series')),
  kp_id TEXT,
  name TEXT NOT NULL,
  en_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  release_date TEXT CHECK (release_date IS NULL OR
    (length(release_date) = 10 AND release_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
     AND date(release_date, '+0 days') IS NOT NULL AND date(release_date, '+0 days') = release_date)),
  age_rating INTEGER,
  rating REAL,
  movie_length INTEGER,
  poster_url TEXT NOT NULL DEFAULT '',
  compact_poster_url TEXT NOT NULL DEFAULT '',
  backdrop_url TEXT NOT NULL DEFAULT '',
  countries_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(countries_json)),
  genres_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(genres_json)),
  director_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(director_json)),
  actors_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(actors_json)),
  year_json TEXT NOT NULL DEFAULT 'null' CHECK (json_valid(year_json)),
  sequels_and_prequels_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(sequels_and_prequels_json)),
  similar_movies_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(similar_movies_json)),
  name_search TEXT NOT NULL DEFAULT '',
  actors_search_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(actors_search_json)),
  director_search_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(director_search_json)),
  UNIQUE (id, kind)
) STRICT, WITHOUT ROWID;
-- Nonunique deliberately: the supplied schema permits duplicate provider IDs.
CREATE INDEX titles_kp_id ON titles(kp_id) WHERE kp_id IS NOT NULL;
CREATE INDEX titles_name ON titles(name, id);
CREATE INDEX titles_rating ON titles(rating DESC, id);
CREATE INDEX titles_kind ON titles(kind, id);
CREATE INDEX titles_name_search ON titles(name_search, id);
CREATE INDEX titles_release ON titles(release_date, id) WHERE release_date IS NOT NULL;

-- Derived genre projection for indexed filters; original ordered JSON stays intact.
CREATE TABLE genres (
  id TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL UNIQUE
) STRICT, WITHOUT ROWID;
CREATE TABLE title_genres (
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  genre_id TEXT NOT NULL REFERENCES genres(id) ON DELETE RESTRICT,
  PRIMARY KEY (title_id, genre_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX title_genres_filter ON title_genres(genre_id, title_id);

CREATE TABLE movie_details (
  title_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL DEFAULT 'movie' CHECK (kind = 'movie'),
  FOREIGN KEY (title_id, kind) REFERENCES titles(id, kind) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE series_details (
  title_id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL DEFAULT 'series' CHECK (kind = 'series'),
  start_year INTEGER CHECK (start_year BETWEEN 1 AND 9999),
  end_year INTEGER CHECK (end_year BETWEEN 1 AND 9999),
  production_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (production_status IN ('unknown', 'in_production', 'finished')),
  announced_season_count INTEGER CHECK (announced_season_count >= 0),
  CHECK (end_year IS NULL OR (start_year IS NOT NULL AND end_year >= start_year)),
  CHECK (end_year IS NULL OR production_status = 'finished'),
  FOREIGN KEY (title_id, kind) REFERENCES titles(id, kind) ON DELETE CASCADE
) STRICT, WITHOUT ROWID;

CREATE TABLE seasons (
  id TEXT PRIMARY KEY NOT NULL CHECK (length(id) > 0),
  series_id TEXT NOT NULL REFERENCES series_details(title_id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL CHECK (season_number >= 0),
  release_year INTEGER CHECK (release_year BETWEEN 1 AND 9999),
  is_available INTEGER NOT NULL DEFAULT 0 CHECK (is_available IN (0, 1)),
  UNIQUE (series_id, season_number)
) STRICT, WITHOUT ROWID;
CREATE INDEX seasons_available ON seasons(series_id, season_number) WHERE is_available = 1;

CREATE TABLE library_entries (
  title_id TEXT PRIMARY KEY NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  added_date TEXT NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX library_added ON library_entries(added_date DESC, title_id);

CREATE TABLE wishlist_entries (
  title_id TEXT PRIMARY KEY NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  added_date TEXT NOT NULL
) STRICT, WITHOUT ROWID;
CREATE INDEX wishlist_added ON wishlist_entries(added_date DESC, title_id);

-- A format records a real quality/extension pairing, rather than a cross product.
-- Titles (including wishlist titles) may have any number of formats.
CREATE TABLE title_formats (
  title_id TEXT NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  quality_id TEXT NOT NULL REFERENCES qualities(id) ON DELETE RESTRICT,
  extension_id TEXT NOT NULL REFERENCES extensions(id) ON DELETE RESTRICT,
  PRIMARY KEY (title_id, quality_id, extension_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX title_formats_quality ON title_formats(quality_id, title_id);
CREATE INDEX title_formats_extension ON title_formats(extension_id, title_id);

-- Optional: identify exactly which formats are available in each season.
CREATE TABLE season_formats (
  season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  quality_id TEXT NOT NULL REFERENCES qualities(id) ON DELETE RESTRICT,
  extension_id TEXT NOT NULL REFERENCES extensions(id) ON DELETE RESTRICT,
  PRIMARY KEY (season_id, quality_id, extension_id)
) STRICT, WITHOUT ROWID;
CREATE INDEX season_formats_quality ON season_formats(quality_id, season_id);
CREATE INDEX season_formats_extension ON season_formats(extension_id, season_id);

CREATE VIEW series_summary AS
SELECT s.*, COALESCE(a.available_season_count, 0) AS available_season_count
FROM series_details s
LEFT JOIN (
  SELECT series_id, COUNT(*) AS available_season_count
  FROM seasons WHERE is_available = 1 AND season_number > 0 GROUP BY series_id
) a ON a.series_id = s.title_id;

CREATE VIEW wishlist_catalog AS
SELECT t.*, w.added_date AS wishlist_added_date
FROM wishlist_entries w JOIN titles t ON t.id = w.title_id;

-- Preserve explicit false versus unknown, and the original numeric provider ID.
CREATE TABLE legacy_movie_values (
  title_id TEXT PRIMARY KEY NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  is_series INTEGER,
  kp_id INTEGER NOT NULL
) STRICT, WITHOUT ROWID;
