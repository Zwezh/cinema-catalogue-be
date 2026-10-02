import { objectBody } from '../../common/validation';
import { validateAddedDate } from '../../common/title-validation';

export function validatePromotion(value: unknown): { addedDate: string } {
  const body = objectBody(value, ['addedDate']);
  return { addedDate: validateAddedDate(body.addedDate) };
}
