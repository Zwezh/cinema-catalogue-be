import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Auth } from './schemas';
import { Model } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(Auth.name) private readonly authModel: Model<Auth>,
    private jwtService: JwtService,
  ) {}

  async signIn(secretKey: string): Promise<{ access_token: string }> {
    const auth = await this.findSecretKey();
    const isMatch = await bcrypt.compare(secretKey, auth.secretKey);
    if (isMatch) {
      const payload = { user: 'Aliaksei Zviazhynski' };
      return {
        access_token: await this.jwtService.signAsync(payload),
      };
    }
    throw new UnauthorizedException();
  }

  async findSecretKey(): Promise<Auth> {
    return this.authModel.findOne({ _id: process.env.JWT_KEY }).exec();
  }
}
