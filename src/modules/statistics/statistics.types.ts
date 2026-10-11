export interface CountBucket {
  label: string;
  count: number;
}
export interface QualityBucket {
  kind: 'quality' | 'multiple' | 'none';
  value: string | null;
  count: number;
}
export interface StatisticsSnapshot {
  version: 1;
  scannedAt: string;
  totals: {
    titles: number;
    movies: number;
    series: number;
    movieRuntimeMinutes: number;
    knownMovieRuntimes: number;
    recordedSeasons: number;
    availableSeasons: number;
    titlesWithoutGenres: number;
  };
  genres: CountBucket[];
  qualities: QualityBucket[];
  decades: { start: number; count: number }[];
  unknownYears: number;
  ratings: {
    bins: { from: number; to: number; count: number }[];
    knownCount: number;
    unknownCount: number;
    mean: number | null;
    median: number | null;
    highRatedCount: number;
  };
}
