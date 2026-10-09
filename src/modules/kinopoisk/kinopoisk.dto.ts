export type KinopoiskNamedValue = {
  readonly name?: string | null;
};

export type KinopoiskImageDto = {
  readonly previewUrl?: string | null;
  readonly url?: string | null;
};

export type KinopoiskPersonDto = {
  readonly enName?: string | null;
  readonly enProfession?: string | null;
  readonly name?: string | null;
};

export type KinopoiskRelatedItemDto = {
  readonly alternativeName?: string | null;
  readonly enName?: string | null;
  readonly name?: string | null;
};

export type KinopoiskFilmDto = {
  readonly ageRating?: number | null;
  readonly alternativeName?: string | null;
  readonly backdrop?: KinopoiskImageDto;
  readonly countries: readonly KinopoiskNamedValue[];
  readonly description?: string | null;
  readonly enName?: string | null;
  readonly genres: readonly KinopoiskNamedValue[];
  readonly isSeries?: boolean | null;
  readonly type?: string | null;
  readonly status?: string | null;
  readonly seriesLength?: number | null;
  readonly premiere?: { readonly world?: string | null };
  readonly releaseYears: readonly {
    readonly start?: number | null;
    readonly end?: number | null;
  }[];
  readonly seasonsInfo: readonly { readonly number?: number | null }[];
  readonly id: number;
  readonly movieLength?: number | null;
  readonly name?: string | null;
  readonly persons: readonly KinopoiskPersonDto[];
  readonly poster?: KinopoiskImageDto;
  readonly rating?: { readonly kp?: number | null };
  readonly sequelsAndPrequels: readonly KinopoiskRelatedItemDto[];
  readonly similarMovies: readonly KinopoiskRelatedItemDto[];
  readonly year?: number | null;
};
