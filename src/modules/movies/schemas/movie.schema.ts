import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MovieDocument = HydratedDocument<Movie>;
const transform = (doc, ret) => {
  ret.id = ret._id;
  delete ret._id;
};

@Schema({
  versionKey: false,
  toJSON: { transform },
})
export class Movie {
  @Prop()
  addedDate: string;
  @Prop()
  ageRating: number;
  @Prop()
  backdropUrl: string;
  @Prop()
  compactPosterUrl: string;
  @Prop()
  countries: string[];
  @Prop()
  description: string;
  @Prop({ type: [String] })
  director: string[];
  @Prop()
  enName: string;
  @Prop()
  extension: string;
  @Prop({ type: [String] })
  genres: string[];
  @Prop()
  id: string;
  @Prop()
  isSeries: boolean;
  @Prop()
  kpId: number;
  @Prop()
  posterUrl: string;
  @Prop()
  name: string;
  @Prop()
  movieLength: number;
  @Prop({ type: [String] })
  actors: string[];
  @Prop()
  quality: string;
  @Prop()
  rating: number;
  @Prop({ type: [Number] })
  year: number | number[];
  @Prop()
  sequelsAndPrequels: string[];
  @Prop()
  similarMovies: string[];
}

export const MovieSchema = SchemaFactory.createForClass(Movie);
