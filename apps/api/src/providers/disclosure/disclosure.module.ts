import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../common/config/configuration';
import { ApiLogService } from '../api-log.service';
import { SchemeMasterService } from '../scheme-master/scheme-master.service';
import { AmcDisclosureProvider } from './amc.provider';
import { DISCLOSURE_PROVIDER } from './disclosure.types';
import { DisclosureImportService } from './disclosure-import.service';
import { FixtureDisclosureProvider } from './fixture.provider';
import { StockMapperService } from './stock-mapper.service';

@Global()
@Module({
  providers: [
    ApiLogService,
    SchemeMasterService,
    StockMapperService,
    FixtureDisclosureProvider,
    AmcDisclosureProvider,
    {
      provide: DISCLOSURE_PROVIDER,
      inject: [ConfigService, FixtureDisclosureProvider, AmcDisclosureProvider],
      useFactory: (
        config: ConfigService<AppConfig, true>,
        fixture: FixtureDisclosureProvider,
        amc: AmcDisclosureProvider,
      ) => {
        const env = config.get('env', { infer: true });
        const logger = new Logger('DisclosureModule');
        if (env.DISCLOSURE_PROVIDER === 'amc') {
          logger.log('Disclosure provider: amc (adapter registry)');
          return amc;
        }
        logger.log('Disclosure provider: fixture (synthetic sample schemes)');
        return fixture;
      },
    },
    DisclosureImportService,
  ],
  exports: [
    DISCLOSURE_PROVIDER,
    DisclosureImportService,
    StockMapperService,
    SchemeMasterService,
    AmcDisclosureProvider,
    ApiLogService,
  ],
})
export class DisclosureModule {}
