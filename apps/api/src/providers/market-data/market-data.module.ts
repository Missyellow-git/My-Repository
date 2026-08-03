import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../common/config/configuration';
import { ApiLogService } from '../api-log.service';
import { HttpMarketDataProvider } from './http.provider';
import { MARKET_DATA_PROVIDER } from './market-data.types';
import { SimulatedMarketDataProvider } from './simulated.provider';

/**
 * Binds the configured adapter to the MARKET_DATA_PROVIDER token. Nothing else
 * in the codebase imports a concrete provider class.
 */
@Global()
@Module({
  providers: [
    ApiLogService,
    SimulatedMarketDataProvider,
    HttpMarketDataProvider,
    {
      provide: MARKET_DATA_PROVIDER,
      inject: [ConfigService, SimulatedMarketDataProvider, HttpMarketDataProvider],
      useFactory: (
        config: ConfigService<AppConfig, true>,
        simulated: SimulatedMarketDataProvider,
        http: HttpMarketDataProvider,
      ) => {
        const env = config.get('env', { infer: true });
        const logger = new Logger('MarketDataModule');

        if (env.MARKET_DATA_PROVIDER === 'http') {
          logger.log(`Market data provider: http (${env.MARKET_DATA_BASE_URL})`);
          return http;
        }

        if (env.NODE_ENV === 'production') {
          // Loud rather than fatal: an operator may knowingly run a staging
          // stack with NODE_ENV=production and no data licence. The banner in
          // the UI, driven by `source`, makes the state visible to users too.
          logger.error(
            'MARKET_DATA_PROVIDER=simulated in a production build — prices shown are SYNTHETIC. ' +
              'Configure a licensed provider before serving real users.',
          );
        } else {
          logger.log('Market data provider: simulated (synthetic prices)');
        }
        return simulated;
      },
    },
  ],
  exports: [MARKET_DATA_PROVIDER, ApiLogService],
})
export class MarketDataModule {}
