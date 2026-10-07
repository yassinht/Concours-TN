import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { RolesGuard } from './auth.guards';

@Global()
@Module({ providers: [AuditService, RolesGuard], exports: [AuditService, RolesGuard] })
export class CommonModule {}
