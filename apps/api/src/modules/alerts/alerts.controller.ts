import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { alertCreateSchema, type AlertCreateInput } from '@fundlens/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { AlertsService } from './alerts.service';

@ApiTags('alerts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/alerts')
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Get()
  @ApiOperation({ summary: 'List alert rules' })
  list(@CurrentUser() user: RequestUser) {
    return this.alerts.list(user.userId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create an alert rule',
    description:
      'NEW_DISCLOSURE / HOLDINGS_CHANGED fire when a scheme publishes a new portfolio. ' +
      'STOCK_MOVE fires when a stock moves by at least `thresholdPct` in either direction, ' +
      'subject to the rule’s cooldown.',
  })
  create(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(alertCreateSchema)) body: AlertCreateInput,
  ) {
    return this.alerts.create(user.userId, body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Enable or disable an alert rule' })
  setActive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { isActive: boolean },
  ) {
    return this.alerts.setActive(user.userId, id, body.isActive !== false);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an alert rule' })
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.alerts.remove(user.userId, id);
  }
}
