import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type MovieDocument = HydratedDocument<Movie>;

@Schema()
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
  @Prop()
  director: string[];
  @Prop()
  enName: string;
  @Prop()
  extension: string;
  @Prop()
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
  @Prop()
  actors: string[];
  @Prop()
  quality: string;
  @Prop()
  rating: number;
  @Prop()
  year: string;
  @Prop()
  sequelsAndPrequels: string[];
  @Prop()
  similarMovies: string[];
}

export const MovieSchema = SchemaFactory.createForClass(Movie);
