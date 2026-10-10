import type { TitleMetadata } from '../../../common/title-metadata';

export type CreateMovieDto = TitleMetadata & {
  readonly wishlistId?: string;
  readonly extension: string;
  readonly isSeries: boolean | null;
  readonly kpId: number;
  readonly movieLength: number;
  readonly quality: string;
  readonly rating: number;
  readonly year: number | number[];
};
