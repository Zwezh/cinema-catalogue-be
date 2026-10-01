export type QualityOption = {
  title: string;
  value: string;
  default?: boolean;
};

export type ExtensionOption = {
  value: string;
  default?: boolean;
};

export type SettingsDto = {
  quality: QualityOption[];
  extension: ExtensionOption[];
  genresForFilters: string[];
};
