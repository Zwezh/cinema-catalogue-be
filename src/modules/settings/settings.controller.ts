import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-guard';
import { SettingsDto } from './dto';
import { Settings } from './schemas';
import { SettingsService } from './settings.service';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  async findOne(): Promise<Settings> {
    return this.settingsService.getSettings();
  }
  @UseGuards(JwtAuthGuard)
  @Put()
  async put(@Body() settingsDto: SettingsDto) {
    return this.settingsService.update(settingsDto);
  }
}
