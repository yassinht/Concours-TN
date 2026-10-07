import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminActorGuard } from './admin-actor.guard';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminFactsService } from './admin-facts.service';
import { AdminOpsService } from './admin-ops.service';
import { AdminQuestionsService } from './admin-questions.service';
import { AdminStatsService } from './admin-stats.service';
import { AdminCatalogController, AdminContentController, AdminOpsController } from './admin.controller';
import { EditionAlertsService } from './edition-alerts.service';
import { ReviewService } from './review.service';

/**
 * Admin module — see docs/api-contract.md for its endpoints. RolesGuard (ADMIN, EDITOR) + AdminActorGuard on every route;
 * user management, payments, broadcast and the waitlist are ADMIN only.
 * Uses the global AlertsService, NotificationsService, EntitlementsService and PaymentsService; CatalogService for cache
 * invalidation after edits.
 */
@Module({
  imports: [CatalogModule],
  controllers: [AdminContentController, AdminCatalogController, AdminOpsController],
  providers: [
    AdminActorGuard,
    AdminStatsService,
    ReviewService,
    AdminQuestionsService,
    AdminCatalogService,
    AdminFactsService,
    AdminOpsService,
    EditionAlertsService,
  ],
  exports: [EditionAlertsService],
})
export class AdminModule {}
