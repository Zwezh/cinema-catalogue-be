import { assertWishlistPromotion } from './promotion-policy';
import { Injectable } from '@nestjs/common';
import { TitlesService } from '../../shared/titles/titles.service';
@Injectable()
export class WishlistService {
  constructor(private readonly titles: TitlesService) {}
  findAll(query: unknown) {
    return this.titles.findAll(query, 'wishlist');
  }
  findOne(id: string) {
    return this.titles.findOne(id, 'wishlist');
  }
  create(value: unknown) {
    return this.titles.create(value, 'wishlist');
  }
  update(id: string, value: unknown) {
    return this.titles.update(id, value, 'wishlist');
  }
  delete(id: string) {
    return this.titles.delete(id, 'wishlist');
  }
  promote(id: string, addedDate: unknown) {
    return this.titles.promote(id, addedDate, assertWishlistPromotion);
  }
}
