export type PaginationParamsDto = {
  currentPage: number;
  direction: 'asc' | 'desc';
  key: string;
  pageSize: number;
  actors?: string;
  directors?: string;
  fromYear?: number;
  genres?: string[];
  rating?: number;
  search?: string;
  toYear?: number;
};
