-- Library pagination (use LIMIT and a cursor instead of deep OFFSETs).
SELECT t.*, l.added_date
FROM library_entries l JOIN titles t ON t.id = l.title_id
WHERE (l.added_date, l.title_id) < (:cursor_date, :cursor_id)
ORDER BY l.added_date DESC, l.title_id DESC LIMIT :page_size;

-- Series display. Season 0 denotes specials and does not inflate the season badge.
SELECT t.*, s.start_year, s.end_year, s.production_status,
  s.announced_season_count, s.available_season_count
FROM titles t JOIN series_summary s ON s.title_id = t.id WHERE t.id = :title_id;

-- Wishlist: pass today's YYYY-MM-DD in the user's timezone; NULL means unknown.
SELECT w.*, CASE WHEN release_date IS NULL THEN NULL
  ELSE release_date <= :today END AS is_released
FROM wishlist_catalog w ORDER BY wishlist_added_date DESC, id DESC LIMIT :page_size;

-- Formats: union season-specific and title-wide values for a series badge.
SELECT q.id, q.value, q.title, e.id AS extension_id, e.value AS extension
FROM (
  SELECT quality_id, extension_id FROM title_formats WHERE title_id = :title_id
  UNION
  SELECT f.quality_id, f.extension_id FROM season_formats f
    JOIN seasons s ON s.id = f.season_id WHERE s.series_id = :title_id AND s.is_available = 1
) f JOIN qualities q ON q.id = f.quality_id JOIN extensions e ON e.id = f.extension_id;

-- Promote wishlist to library atomically; retain title metadata and formats.
-- Run inside an application write transaction; use ISO UTC for :added_date.
INSERT INTO library_entries(title_id, added_date) VALUES (:title_id, :added_date);
DELETE FROM wishlist_entries WHERE title_id = :title_id;

-- Indexed genre filtering; normalize/rebuild title_genres in the same metadata write.
SELECT t.* FROM title_genres tg JOIN titles t ON t.id = tg.title_id
WHERE tg.genre_id = :genre_id ORDER BY t.name, t.id LIMIT :page_size;
