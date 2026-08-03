import { Injectable } from '@nestjs/common';
import type { PreferencesInput, Watchlist, WatchlistCreateInput } from '@fundlens/shared';
import { ConflictException, ForbiddenException } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { FundsService } from '../funds/funds.service';

/**
 * Per-user data: favourites, watchlists, preferences and notifications.
 *
 * Every method takes `userId` as its first argument and scopes its query by it.
 * Ownership is never inferred from a path parameter alone — a watchlist id in
 * the URL is combined with the caller's id in the WHERE clause, so guessing an
 * id yields a 404 rather than someone else's data.
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly funds: FundsService,
  ) {}

  // --- Favourites ---------------------------------------------------------

  async listFavorites(userId: string) {
    const favorites = await this.prisma.favoriteFund.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { id: true, fundId: true, createdAt: true },
    });

    // Reuse the cached fund projection instead of a join, so a favourites list
    // costs Redis reads rather than a widening query.
    const funds = await Promise.all(favorites.map((f) => this.funds.getSummary(f.fundId)));

    return favorites.map((favorite, i) => ({
      id: favorite.id,
      addedAt: favorite.createdAt.toISOString(),
      fund: funds[i],
    }));
  }

  async addFavorite(userId: string, fundId: string) {
    // Validates the fund exists (throws FundNotFoundException) before writing.
    await this.funds.getSummary(fundId);
    try {
      const created = await this.prisma.favoriteFund.create({ data: { userId, fundId } });
      return { id: created.id, fundId, addedAt: created.createdAt.toISOString() };
    } catch {
      throw new ConflictException('That scheme is already in your favourites.');
    }
  }

  async removeFavorite(userId: string, fundId: string): Promise<void> {
    const result = await this.prisma.favoriteFund.deleteMany({ where: { userId, fundId } });
    if (result.count === 0) throw new ForbiddenException('That favourite does not exist.');
  }

  // --- Preferences --------------------------------------------------------

  async getPreferences(userId: string) {
    const preference = await this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    return {
      priceRefreshSeconds: preference.priceRefreshSeconds,
      defaultFundId: preference.defaultFundId,
      theme: preference.theme,
      emailNotifications: preference.emailNotifications,
    };
  }

  async updatePreferences(userId: string, input: PreferencesInput) {
    await this.prisma.userPreference.upsert({
      where: { userId },
      create: { userId, ...stripUndefined(input) },
      update: stripUndefined(input),
    });
    return this.getPreferences(userId);
  }

  // --- Watchlists ---------------------------------------------------------

  async listWatchlists(userId: string): Promise<Watchlist[]> {
    const watchlists = await this.prisma.watchlist.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: {
          include: { stock: { select: { id: true, name: true, nseSymbol: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return watchlists.map((w) => ({
      id: w.id,
      name: w.name,
      createdAt: w.createdAt.toISOString(),
      items: w.items.map((item) => ({
        id: item.id,
        stockId: item.stockId,
        stockName: item.stock.name,
        nseSymbol: item.stock.nseSymbol,
      })),
    }));
  }

  async createWatchlist(userId: string, input: WatchlistCreateInput) {
    try {
      const watchlist = await this.prisma.watchlist.create({
        data: {
          userId,
          name: input.name,
          items: { create: input.stockIds.map((stockId) => ({ stockId })) },
        },
        select: { id: true },
      });
      return this.getWatchlist(userId, watchlist.id);
    } catch {
      throw new ConflictException('You already have a watchlist with that name.');
    }
  }

  async getWatchlist(userId: string, watchlistId: string): Promise<Watchlist> {
    const all = await this.listWatchlists(userId);
    const found = all.find((w) => w.id === watchlistId);
    if (!found) throw new ForbiddenException('That watchlist does not exist.');
    return found;
  }

  async addWatchlistItem(userId: string, watchlistId: string, stockId: string) {
    await this.assertOwnsWatchlist(userId, watchlistId);
    await this.prisma.watchlistItem.create({ data: { watchlistId, stockId } }).catch(() => {
      throw new ConflictException('That stock is already on the watchlist.');
    });
    return this.getWatchlist(userId, watchlistId);
  }

  async removeWatchlistItem(userId: string, watchlistId: string, stockId: string) {
    await this.assertOwnsWatchlist(userId, watchlistId);
    await this.prisma.watchlistItem.deleteMany({ where: { watchlistId, stockId } });
    return this.getWatchlist(userId, watchlistId);
  }

  async deleteWatchlist(userId: string, watchlistId: string): Promise<void> {
    const result = await this.prisma.watchlist.deleteMany({ where: { id: watchlistId, userId } });
    if (result.count === 0) throw new ForbiddenException('That watchlist does not exist.');
  }

  // --- Notifications ------------------------------------------------------

  async listNotifications(userId: string, unreadOnly = false, limit = 50) {
    const rows = await this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((n) => ({
      id: n.id,
      title: n.title,
      body: n.body,
      payload: n.payload,
      readAt: n.readAt?.toISOString() ?? null,
      createdAt: n.createdAt.toISOString(),
    }));
  }

  async markNotificationsRead(userId: string, ids?: string[]): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { readAt: new Date() },
    });
    return result.count;
  }

  private async assertOwnsWatchlist(userId: string, watchlistId: string): Promise<void> {
    const count = await this.prisma.watchlist.count({ where: { id: watchlistId, userId } });
    if (count === 0) throw new ForbiddenException('That watchlist does not exist.');
  }
}

/** Prisma treats an explicit `undefined` as "no change"; keys must be dropped. */
function stripUndefined<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}
