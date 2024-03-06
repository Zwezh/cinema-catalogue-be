import { Body, Controller, Get, Put } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { Settings } from './schemas';
import { SettingsDto } from './dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async findOne(): Promise<Settings> {
    return this.settingsService.getSettings();
  }

  @Put()
  async put(@Body() settingsDto: SettingsDto) {
    return this.settingsService.update(settingsDto);
  }
}
