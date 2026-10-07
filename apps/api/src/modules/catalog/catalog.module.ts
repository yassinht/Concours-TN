import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { EditionStatusJob } from './edition-status.job';
import { SyllabusService } from './syllabus.service';

/** Catalog module — public read-side of concours families, editions, eligibility and syllabus (docs/api-contract.md). */
@Module({
  imports: [],
  controllers: [CatalogController],
  providers: [CatalogService, SyllabusService, EditionStatusJob],
  exports: [CatalogService, SyllabusService, EditionStatusJob],
})
export class CatalogModule {}
