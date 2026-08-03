import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Prisma client wrapper.
 *
 * The `query` event listener logs statements slower than the threshold rather
 * than every statement: at the volumes this service targets, logging every
 * query is both a cost and a privacy problem, but silent slow queries are how
 * a dashboard degrades without anyone noticing.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private static readonly SLOW_QUERY_MS = 200;

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      errorFormat: 'minimal',
    });
  }

  async onModuleInit(): Promise<void> {
    // `as never` narrows Prisma's overloaded $on signature, which cannot infer
    // the event union when the client is subclassed.
    (this.$on as never as (e: 'query', cb: (ev: Prisma.QueryEvent) => void) => void)(
      'query',
      (event) => {
        if (event.duration >= PrismaService.SLOW_QUERY_MS) {
          this.logger.warn(
            { durationMs: event.duration, query: event.query },
            `Slow query (${event.duration}ms)`,
          );
        }
      },
    );

    (this.$on as never as (e: 'error', cb: (ev: Prisma.LogEvent) => void) => void)(
      'error',
      (event) => {
        this.logger.error({ target: event.target }, event.message);
      },
    );

    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Nest's shutdown hooks do not fire on SIGINT unless enabled explicitly, and
   * without this a `docker compose down` leaves connections dangling until the
   * server's idle timeout.
   */
  enableShutdownHooks(app: INestApplication): void {
    process.on('beforeExit', () => {
      void app.close();
    });
  }

  /** Lightweight liveness probe used by the health module. */
  async ping(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
