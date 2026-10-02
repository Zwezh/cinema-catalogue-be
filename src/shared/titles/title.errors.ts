export class CatalogOptionError extends Error {
  constructor() {
    super('quality and extension must reference configured options');
  }
}
export class TitleConflictError extends Error {
  constructor() {
    super('A title with the same kpId already exists');
  }
}

export class TitleNotFoundError extends Error {
  constructor() {
    super('Title not found');
  }
}
export class TitleInputError extends Error {}
export class LibraryConflictError extends Error {
  constructor() {
    super('Title is already in the library');
  }
}
