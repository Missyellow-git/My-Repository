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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  favoriteSchema,
  preferencesSchema,
  watchlistCreateSchema,
  type PreferencesInput,
  type WatchlistCreateInput,
} from '@fundlens/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { JwtAuthGuard } from '../auth/optional-jwt-auth.guard';
import { UsersService } from './users.service';

@ApiTags('me')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('favorites')
  @ApiOperation({ summary: 'Saved mutual fund schemes' })
  listFavorites(@CurrentUser() user: RequestUser) {
    return this.users.listFavorites(user.userId);
  }

  @Post('favorites')
  @ApiOperation({ summary: 'Save a scheme' })
  addFavorite(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(favoriteSchema)) body: { fundId: string },
  ) {
    return this.users.addFavorite(user.userId, body.fundId);
  }

  @Delete('favorites/:fundId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove a saved scheme' })
  async removeFavorite(
    @CurrentUser() user: RequestUser,
    @Param('fundId', ParseUUIDPipe) fundId: string,
  ) {
    await this.users.removeFavorite(user.userId, fundId);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'User preferences (refresh interval, theme, default scheme)' })
  getPreferences(@CurrentUser() user: RequestUser) {
    return this.users.getPreferences(user.userId);
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update preferences' })
  updatePreferences(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(preferencesSchema)) body: PreferencesInput,
  ) {
    return this.users.updatePreferences(user.userId, body);
  }

  @Get('watchlists')
  @ApiOperation({ summary: 'Stock watchlists' })
  listWatchlists(@CurrentUser() user: RequestUser) {
    return this.users.listWatchlists(user.userId);
  }

  @Post('watchlists')
  @ApiOperation({ summary: 'Create a watchlist' })
  createWatchlist(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(watchlistCreateSchema)) body: WatchlistCreateInput,
  ) {
    return this.users.createWatchlist(user.userId, body);
  }

  @Post('watchlists/:id/items/:stockId')
  @ApiOperation({ summary: 'Add a stock to a watchlist' })
  addWatchlistItem(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stockId', ParseUUIDPipe) stockId: string,
  ) {
    return this.users.addWatchlistItem(user.userId, id, stockId);
  }

  @Delete('watchlists/:id/items/:stockId')
  @ApiOperation({ summary: 'Remove a stock from a watchlist' })
  removeWatchlistItem(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('stockId', ParseUUIDPipe) stockId: string,
  ) {
    return this.users.removeWatchlistItem(user.userId, id, stockId);
  }

  @Delete('watchlists/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a watchlist' })
  async deleteWatchlist(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.users.deleteWatchlist(user.userId, id);
  }

  @Get('notifications')
  @ApiOperation({ summary: 'Alert notifications' })
  listNotifications(@CurrentUser() user: RequestUser, @Query('unreadOnly') unreadOnly?: string) {
    return this.users.listNotifications(user.userId, unreadOnly === 'true');
  }

  @Post('notifications/read')
  @ApiOperation({ summary: 'Mark notifications as read (all, or the supplied ids)' })
  async markRead(@CurrentUser() user: RequestUser, @Body() body: { ids?: string[] }) {
    const count = await this.users.markNotificationsRead(user.userId, body?.ids);
    return { markedRead: count };
  }
}
