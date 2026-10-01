export type MovieAutofill = {
  readonly actors: readonly string[];
  readonly ageRating?: number;
  readonly backdropUrl: string;
  readonly compactPosterUrl: string;
  readonly countries: readonly string[];
  readonly description: string;
  readonly directors: readonly string[];
  readonly enName: string;
  readonly genres: readonly string[];
  readonly kpId: number;
  readonly movieLength?: number;
  readonly name: string;
  readonly posterUrl: string;
  readonly rating?: number;
  readonly sequelsAndPrequels: readonly string[];
  readonly similarMovies: readonly string[];
  readonly year?: number;
};
