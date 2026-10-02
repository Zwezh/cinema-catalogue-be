export type QualityOption = {
  id?: string;
  title: string;
  value: string;
  default?: boolean;
};

export type ExtensionOption = {
  id?: string;
  value: string;
  default?: boolean;
};

export type SettingsDto = {
  quality: QualityOption[];
  extension: ExtensionOption[];
  genresForFilters: string[];
};
