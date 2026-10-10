import { providerId } from '../../shared/titles/provider-id';
import { ConflictException } from '@nestjs/common';
import { KinopoiskService } from '../kinopoisk/kinopoisk.service';
import { providerWishlist, wishlistProviderId } from './provider-wishlist';
import { Injectable } from '@nestjs/common';
import { TitlesService } from '../../shared/titles/titles.service';
@Injectable()
export class WishlistService {
  constructor(
    private readonly titles: TitlesService,
    private readonly provider: KinopoiskService,
  ) {}
  findAll(query: unknown) {
    return this.titles.findAll(query, 'wishlist');
  }
  findOne(id: string) {
    return this.titles.wishlistSnapshot(id).then((snapshot) => snapshot.title);
  }
  async createFromKinopoisk(value: unknown) {
    const kpId = wishlistProviderId(value);
    const title = await this.titles.create(
      providerWishlist(await this.provider.getTitleAutofill(Number(kpId))),
      'wishlist',
    );
    return { id: title.id };
  }
  async refresh(id: string, value: unknown) {
    const kpId = wishlistProviderId(value);
    const snapshot = await this.titles.wishlistSnapshot(id);
    if (providerId(snapshot.title.kpId) !== kpId)
      throw new ConflictException('Wishlist provider identity changed');
    const metadata = await this.provider.getTitleAutofill(Number(kpId));
    return this.titles.refreshWishlist(
      id,
      providerWishlist(metadata, snapshot.title),
      snapshot.revision,
    );
  }
  delete(id: string) {
    return this.titles.delete(id, 'wishlist');
  }
}
