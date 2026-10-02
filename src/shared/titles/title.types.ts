import type { TitleMetadata } from '../../common/title-metadata';

export type Format = { qualityId: string; extensionId: string };
export type Season = {
  seasonNumber: number;
  releaseYear: number | null;
  isAvailable: boolean;
  formats: Format[];
};
export type SeriesDetails = {
  startYear: number | null;
  endYear: number | null;
  productionStatus: 'unknown' | 'in_production' | 'finished';
  announcedSeasonCount: number | null;
  seasons: Season[];
};
export type TitleInput = TitleMetadata & {
  kind: 'movie' | 'series';
  kpId: string | null;
  year: number | number[] | null;
  movieLength: number | null;
  rating: number | null;
  releaseDate: string | null;
  formats: Format[];
  series: SeriesDetails | null;
};
export type Title = TitleInput & {
  id: string;
  availableSeasonCount: number | null;
};
export type Membership = 'library' | 'wishlist';
