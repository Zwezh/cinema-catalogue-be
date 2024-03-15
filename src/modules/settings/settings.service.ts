import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SettingsDto } from './dto';
import { Settings } from './schemas';

@Injectable()
export class SettingsService {
  constructor(
    @InjectModel(Settings.name) private readonly settingsModel: Model<Settings>,
  ) {}

  async getSettings(): Promise<Settings> {
    return this.settingsModel
      .findById({ _id: '65e70d3e350be01cc7546abc' })
      .exec();
  }

  async update(settingsDto: SettingsDto): Promise<SettingsDto> {
    const settings = await this.settingsModel.findByIdAndUpdate(
      { _id: '65e70d3e350be01cc7546abc' },
      settingsDto,
    );
    if (!settings) {
      throw new NotFoundException(`Settings not found`);
    }
    return settings;
  }
}
