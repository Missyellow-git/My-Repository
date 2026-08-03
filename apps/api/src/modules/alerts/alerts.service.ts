import { Injectable, Logger } from '@nestjs/common';
import { AlertType, SnapshotStatus, type AlertCreateInput, type AlertRule } from '@fundlens/shared';
import { ForbiddenException } from '../../common/errors';
import { toNum } from '../../common/utils/decimal';
import { PrismaService } from '../../prisma/prisma.service';
import { PricesService } from '../prices/prices.service';

export interface AlertEvaluationStats {
  rulesEvaluated: number;
  notificationsCreated: number;
  skippedInCooldown: number;
}

/**
 * Alert rules and their evaluation.
 *
 * Evaluation is pull-based and runs on a schedule rather than being triggered
 * from the request path: alerts must fire for users who are not looking at the
 * dashboard, which is the entire point of them.
 *
 * Every rule carries a cooldown. Without one, a stock oscillating around a 2%
 * threshold would generate a notification per evaluation cycle — the classic
 * way alerting becomes noise and then gets ignored.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly prices: PricesService,
  ) {}

  async list(userId: string): Promise<AlertRule[]> {
    const rules = await this.prisma.alertRule.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rules.map(toAlertRule);
  }

  async create(userId: string, input: AlertCreateInput): Promise<AlertRule> {
    const rule = await this.prisma.alertRule.create({
      data: {
        userId,
        type: input.type,
        channel: input.channel,
        fundId: input.fundId ?? null,
        stockId: input.stockId ?? null,
        thresholdPct: input.thresholdPct ?? null,
      },
    });
    return toAlertRule(rule);
  }

  async setActive(userId: string, alertId: string, isActive: boolean): Promise<AlertRule> {
    const result = await this.prisma.alertRule.updateMany({
      where: { id: alertId, userId },
      data: { isActive },
    });
    if (result.count === 0) throw new ForbiddenException('That alert does not exist.');
    const rule = await this.prisma.alertRule.findUniqueOrThrow({ where: { id: alertId } });
    return toAlertRule(rule);
  }

  async remove(userId: string, alertId: string): Promise<void> {
    const result = await this.prisma.alertRule.deleteMany({ where: { id: alertId, userId } });
    if (result.count === 0) throw new ForbiddenException('That alert does not exist.');
  }

  /**
   * Evaluates every active price-movement rule.
   *
   * Reads quotes from the cache/DB rather than forcing a provider fetch: the
   * price-refresh job has already populated them, and making alerting a second
   * consumer of the vendor quota would double our spend for no extra freshness.
   */
  async evaluatePriceAlerts(): Promise<AlertEvaluationStats> {
    const stats: AlertEvaluationStats = {
      rulesEvaluated: 0,
      notificationsCreated: 0,
      skippedInCooldown: 0,
    };

    const rules = await this.prisma.alertRule.findMany({
      where: { isActive: true, type: AlertType.STOCK_MOVE, stockId: { not: null } },
      include: { stock: { select: { id: true, name: true, nseSymbol: true } } },
    });
    if (rules.length === 0) return stats;

    const now = Date.now();
    const due = rules.filter((rule) => {
      if (!rule.lastTriggeredAt) return true;
      const withinCooldown = now - rule.lastTriggeredAt.getTime() < rule.cooldownMinutes * 60_000;
      if (withinCooldown) stats.skippedInCooldown += 1;
      return !withinCooldown;
    });

    const stockIds = [...new Set(due.map((r) => r.stockId!))];
    const { quotes } = await this.prices.getQuotes(stockIds, false);

    for (const rule of due) {
      stats.rulesEvaluated += 1;
      const quote = quotes.get(rule.stockId!);
      const changePct = quote?.changePct;
      const threshold = toNum(rule.thresholdPct);
      if (changePct === null || changePct === undefined || threshold === null) continue;

      // Threshold is stored as a magnitude and evaluated symmetrically: a "5%"
      // alert fires on -5% too, because a user watching a position wants to
      // know about either direction.
      if (Math.abs(changePct) < threshold) continue;

      const direction = changePct >= 0 ? 'up' : 'down';
      await this.fire(rule.userId, rule.id, {
        title: `${rule.stock?.name ?? 'A holding'} is ${direction} ${Math.abs(changePct).toFixed(2)}%`,
        body:
          `${rule.stock?.nseSymbol ?? rule.stock?.name} is trading at ₹${quote?.ltp ?? '—'}, ` +
          `${direction} ${Math.abs(changePct).toFixed(2)}% against the previous close. ` +
          `Your alert threshold is ${threshold}%.`,
        payload: { stockId: rule.stockId, changePct, ltp: quote?.ltp ?? null, threshold },
      });
      stats.notificationsCreated += 1;
    }

    return stats;
  }

  /**
   * Fires disclosure alerts for snapshots the import job just published.
   *
   * @param snapshotIds Snapshots created in this import run — passed in rather
   *   than rediscovered so a rerun cannot re-notify on an unchanged period.
   */
  async evaluateDisclosureAlerts(snapshotIds: string[]): Promise<AlertEvaluationStats> {
    const stats: AlertEvaluationStats = {
      rulesEvaluated: 0,
      notificationsCreated: 0,
      skippedInCooldown: 0,
    };
    if (snapshotIds.length === 0) return stats;

    const snapshots = await this.prisma.portfolioSnapshot.findMany({
      where: { id: { in: snapshotIds }, status: SnapshotStatus.PUBLISHED },
      include: { fund: { select: { id: true, name: true } } },
    });

    for (const snapshot of snapshots) {
      const rules = await this.prisma.alertRule.findMany({
        where: {
          isActive: true,
          fundId: snapshot.fundId,
          type: { in: [AlertType.NEW_DISCLOSURE, AlertType.HOLDINGS_CHANGED] },
        },
      });

      for (const rule of rules) {
        stats.rulesEvaluated += 1;
        await this.fire(rule.userId, rule.id, {
          title: `New disclosure for ${snapshot.fund.name}`,
          body:
            `The ${snapshot.disclosureDate.toISOString().slice(0, 10)} portfolio disclosure is now available, ` +
            `covering ${snapshot.holdingsCount} instruments (${snapshot.equityCount} equity positions).`,
          payload: {
            fundId: snapshot.fundId,
            snapshotId: snapshot.id,
            disclosureDate: snapshot.disclosureDate.toISOString().slice(0, 10),
          },
        });
        stats.notificationsCreated += 1;
      }
    }

    return stats;
  }

  private async fire(
    userId: string,
    alertRuleId: string,
    notification: { title: string; body: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.notification.create({
        data: {
          userId,
          alertRuleId,
          title: notification.title,
          body: notification.body,
          payload: notification.payload as never,
        },
      }),
      this.prisma.alertRule.update({
        where: { id: alertRuleId },
        data: { lastTriggeredAt: new Date() },
      }),
    ]);

    // Email and webhook delivery are intentionally not implemented here — they
    // need a provider (SES/Postmark) and per-tenant configuration. The in-app
    // notification row is written regardless, so nothing is lost when delivery
    // is added: the dispatcher will read from this table.
    this.logger.debug(`Notification queued for user ${userId}: ${notification.title}`);
  }
}

function toAlertRule(rule: {
  id: string;
  type: string;
  channel: string;
  fundId: string | null;
  stockId: string | null;
  thresholdPct: unknown;
  isActive: boolean;
  lastTriggeredAt: Date | null;
  createdAt: Date;
}): AlertRule {
  return {
    id: rule.id,
    type: rule.type as AlertRule['type'],
    channel: rule.channel as AlertRule['channel'],
    fundId: rule.fundId,
    stockId: rule.stockId,
    thresholdPct: toNum(rule.thresholdPct as never),
    isActive: rule.isActive,
    lastTriggeredAt: rule.lastTriggeredAt?.toISOString() ?? null,
    createdAt: rule.createdAt.toISOString(),
  };
}
