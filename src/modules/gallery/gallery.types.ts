import type { PaginationParamsDto } from '../../common/pagination-params';
import type { Title, SeriesDetails } from '../../shared/titles/title.types';
export const galleryCollections = ['movies', 'series', 'wishlist'] as const;
export const galleryKinds = ['movie', 'series'] as const;
export const gallerySortKeys = [
  'addedDate',
  'ageRating',
  'enName',
  'kpId',
  'movieLength',
  'name',
  'rating',
  'year',
] as const;
export type GalleryCollection = (typeof galleryCollections)[number];
export type GalleryQuery = PaginationParamsDto & {
  collections: GalleryCollection[];
  kinds: Title['kind'][];
};
export type GalleryItem = Pick<
  Title,
  | 'id'
  | 'kind'
  | 'kpId'
  | 'name'
  | 'enName'
  | 'addedDate'
  | 'year'
  | 'rating'
  | 'ageRating'
  | 'movieLength'
  | 'posterUrl'
  | 'compactPosterUrl'
  | 'genres'
  | 'director'
> & {
  collection: GalleryCollection;
  qualityValues: string[];
  series:
    | (Pick<SeriesDetails, 'startYear' | 'endYear' | 'productionStatus'> & {
        availableSeasonCount: number;
        recordedSeasonCount: number;
      })
    | null;
};
