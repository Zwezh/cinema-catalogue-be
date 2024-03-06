import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SettingsDocument = HydratedDocument<Settings>;

@Schema()
export class Settings {
  @Prop()
  quality: string;
  @Prop()
  extension: string;
  @Prop()
  genresForFilters: string[];
}

export const SettingsSchema = SchemaFactory.createForClass(Settings);
