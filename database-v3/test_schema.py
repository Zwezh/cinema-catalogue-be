"""Offline schema/migration tests; no production database or credentials used."""
import pathlib
import sqlite3
import unittest

ROOT = pathlib.Path(__file__).parent
SCHEMA = (ROOT / 'schema.sql').read_text()
MIGRATION = (ROOT / 'migrate.sql').read_text()


def legacy():
    db = sqlite3.connect(':memory:')
    db.execute('PRAGMA foreign_keys=ON')
    db.executescript('''
      CREATE TABLE auth(id TEXT PRIMARY KEY, secret_key TEXT NOT NULL);
      CREATE TABLE settings(id INTEGER PRIMARY KEY, genres_for_filters_json TEXT NOT NULL);
      CREATE TABLE quality_options(settings_id INTEGER, value TEXT, title TEXT, is_default INTEGER, sort_order INTEGER);
      CREATE TABLE extension_options(settings_id INTEGER, value TEXT, is_default INTEGER, sort_order INTEGER);
      CREATE TABLE movies(id TEXT PRIMARY KEY, added_date TEXT, age_rating INTEGER,
        backdrop_url TEXT, compact_poster_url TEXT, countries_json TEXT, description TEXT,
        director_json TEXT, en_name TEXT, extension TEXT, genres_json TEXT, is_series INTEGER,
        kp_id INTEGER, poster_url TEXT, name TEXT, movie_length INTEGER, actors_json TEXT,
        quality TEXT, rating REAL, year_json TEXT, sequels_and_prequels_json TEXT, similar_movies_json TEXT,
        name_search TEXT);
      INSERT INTO settings VALUES(1, '[ "Drama" ]');
      INSERT INTO auth VALUES('auth:old', 'unchanged-secret');
      INSERT INTO quality_options VALUES(1, '1080p', 'FHD', 1, 0), (1, '2160p', '4K', 0, 1);
      INSERT INTO extension_options VALUES(1, 'MKV', 1, 0), (1, 'MP4', 0, 1);
    ''')
    for number, flag in enumerate([None, 0, 1]):
        db.execute('INSERT INTO movies VALUES (' + ','.join('?' for _ in range(23)) + ')', (
            f'original-long-id-{number}', '2024-03-01T12:00:00Z', None, 'back', 'compact',
            '[ "PL", "US" ]', 'description', '["Director"]', 'English',
            'OLD' if number == 2 else 'MKV', '["Drama"]', flag, 123,
            'poster', 'Название', 120, '["Actor", "Actor"]',
            'custom' if number == 2 else '1080p', 8.5, '[2020, 2021]', '["external-id"]', '[]', 'search'))
    db.commit()
    return db


class SchemaTests(unittest.TestCase):
    def setUp(self):
        self.db = legacy()
        self.db.executescript(SCHEMA + MIGRATION)

    def tearDown(self):
        self.db.close()

    def test_preservation(self):
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM titles').fetchone()[0], 3)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM movies').fetchone()[0], 3)
        columns = ['age_rating', 'backdrop_url', 'compact_poster_url', 'countries_json',
                   'description', 'director_json', 'en_name', 'genres_json', 'kp_id',
                   'poster_url', 'name', 'movie_length', 'actors_json', 'rating', 'year_json',
                   'sequels_and_prequels_json', 'similar_movies_json']
        for column in columns:
            comparison = f'CAST(m.{column} AS TEXT)' if column == 'kp_id' else f'm.{column}'
            self.assertEqual(self.db.execute(f'SELECT COUNT(*) FROM movies m JOIN titles t USING(id) WHERE t.{column} IS NOT {comparison}').fetchone()[0], 0)
        self.assertEqual(self.db.execute('SELECT is_series FROM legacy_movie_values ORDER BY title_id').fetchall(), [(None,), (0,), (1,)])
        self.assertEqual(self.db.execute("SELECT is_active FROM qualities WHERE value='custom'").fetchone(), (0,))
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_seasons_and_formats(self):
        title = 'original-long-id-2'
        self.db.execute("UPDATE series_details SET start_year=2020, end_year=2025, production_status='finished' WHERE title_id=?", (title,))
        for number in [0, 1, 2, 4]:
            self.db.execute('INSERT INTO seasons(id, series_id, season_number, is_available) VALUES(?,?,?,1)', (f'season:{number}', title, number))
        self.assertEqual(self.db.execute('SELECT available_season_count FROM series_summary').fetchone(), (3,))
        quality = self.db.execute("SELECT id FROM qualities WHERE value='2160p'").fetchone()[0]
        extension = self.db.execute("SELECT id FROM extensions WHERE value='MP4'").fetchone()[0]
        self.db.execute('INSERT INTO title_formats VALUES(?,?,?)', (title, quality, extension))
        self.db.execute('INSERT INTO season_formats VALUES(?,?,?)', ('season:1', quality, extension))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM title_formats WHERE title_id=?', (title,)).fetchone(), (2,))

    def test_constraints(self):
        bad = [
            "INSERT INTO title_formats VALUES('original-long-id-0','missing','missing')",
            "INSERT INTO movie_details(title_id) VALUES('original-long-id-2')",
            "UPDATE titles SET kind='movie' WHERE id='original-long-id-2'",
            "UPDATE series_details SET end_year=2010 WHERE title_id='original-long-id-2'",
            "UPDATE settings_qualities SET is_default=1",
            "DELETE FROM qualities WHERE value='1080p'",
            "INSERT INTO seasons VALUES('bad','original-long-id-2',-1,NULL,0)",
            "UPDATE titles SET actors_json='broken'",
            "UPDATE titles SET release_date='2025-02-30' WHERE id='original-long-id-0'",
        ]
        for sql in bad:
            with self.subTest(sql=sql), self.assertRaises(sqlite3.IntegrityError):
                self.db.execute(sql)

    def test_wishlist_promotion(self):
        self.db.execute("INSERT INTO titles(id,kind,name) VALUES('future','series','Future series')")
        self.db.execute("INSERT INTO series_details(title_id) VALUES('future')")
        self.db.execute("UPDATE titles SET release_date='2027-01-01' WHERE id='future'")
        self.db.execute("INSERT INTO wishlist_entries VALUES('future','2026-10-01')")
        self.db.execute("INSERT INTO library_entries VALUES('future','2027-01-02')")
        self.db.execute("DELETE FROM wishlist_entries WHERE title_id='future'")
        self.assertEqual(self.db.execute("SELECT name FROM titles WHERE id='future'").fetchone(), ('Future series',))
        self.assertEqual(self.db.execute("SELECT release_date FROM titles WHERE id='future'").fetchone(), ('2027-01-01',))
        self.db.execute("DELETE FROM titles WHERE id='original-long-id-2'")
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM series_details').fetchone(), (1,))

    def test_all_new_keys_are_text(self):
        tables = self.db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        legacy_tables = {'movies', 'auth', 'settings', 'quality_options', 'extension_options'}
        for (table,) in tables:
            if table in legacy_tables:
                continue
            for column in self.db.execute(f'PRAGMA table_info({table})'):
                if column[5]:
                    self.assertEqual(column[2], 'TEXT', (table, column))

    def test_invalid_json_aborts_transaction(self):
        db = legacy()
        db.execute("UPDATE movies SET genres_json='invalid'")
        db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            db.executescript('BEGIN IMMEDIATE;\n' + SCHEMA + MIGRATION + '\nCOMMIT;')
        db.rollback()
        self.assertEqual(db.execute("SELECT COUNT(*) FROM sqlite_master WHERE name='titles'").fetchone(), (0,))
        self.assertEqual(db.execute('SELECT COUNT(*) FROM movies').fetchone(), (3,))
        db.close()


if __name__ == '__main__':
    unittest.main()
