import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FundsModule } from '../funds/funds.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [AuthModule, FundsModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
