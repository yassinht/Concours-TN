import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ActiveUserGuard } from './active-user.guard';
import { CandidateToolsService } from './candidate-tools.service';
import { EnrollmentsService } from './enrollments.service';
import { CandidateToolsController, EmailPreferencesController, EnrollmentsController, ProfileController } from './users.controller';
import { UsersService } from './users.service';

/** Users module — see docs/api-contract.md for its endpoints. */
@Module({
  imports: [AuthModule],
  controllers: [ProfileController, EnrollmentsController, CandidateToolsController, EmailPreferencesController],
  providers: [UsersService, EnrollmentsService, CandidateToolsService, ActiveUserGuard],
  exports: [UsersService, EnrollmentsService],
})
export class UsersModule {}
