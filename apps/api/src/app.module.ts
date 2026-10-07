import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CommonModule } from './common/common.module';
import { DbModule } from './db/db.module';
import { HealthController } from './health.controller';
import { AdminModule } from './modules/admin/admin.module';
import { AiModule } from './modules/ai/ai.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { GrowthModule } from './modules/growth/growth.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { LearningModule } from './modules/learning/learning.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PracticeModule } from './modules/practice/practice.module';
import { TutorModule } from './modules/tutor/tutor.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    DbModule,
    CommonModule,
    AiModule,
    LearningModule,
    GamificationModule,
    NotificationsModule,
    BillingModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    PracticeModule,
    TutorModule,
    AdminModule,
    IngestionModule,
    GrowthModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
