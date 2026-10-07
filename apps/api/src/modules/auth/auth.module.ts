import { Module } from '@nestjs/common';
import { AlertsTrigger } from './alerts-trigger.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { GuestMergeService } from './guest-merge.service';
import { MeService } from './me.service';

/** Auth module — see docs/api-contract.md for its endpoints. */
@Module({
  imports: [],
  controllers: [AuthController],
  providers: [AuthService, MeService, GuestMergeService, GoogleOAuthService, AlertsTrigger],
  exports: [AuthService, MeService, AlertsTrigger],
})
export class AuthModule {}
