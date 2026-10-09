import type { TitleMetadata } from '../../common/title-metadata';
import type { SeriesDetails, Season } from '../../shared/titles/title.types';

/** Provider metadata only; membership dates, local formats and availability are never inferred. */
export type TitleAutofill = Omit<TitleMetadata, 'addedDate' | 'director'> & {
  readonly directors: string[];
  readonly kind: 'movie' | 'series' | null;
  readonly kpId: string;
  readonly ageRating: number | null;
  readonly year: number | number[] | null;
  readonly movieLength: number | null;
  readonly rating: number | null;
  readonly releaseDate: string | null;
  readonly series:
    | (Omit<SeriesDetails, 'seasons'> & {
        seasons: Pick<Season, 'seasonNumber' | 'releaseYear'>[];
      })
    | null;
};
