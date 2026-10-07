import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { AdminCatalogService } from './admin-catalog.service';
import { AdminOpsService } from './admin-ops.service';
import { EditionAlertsService } from './edition-alerts.service';

it('resolves admin providers inside the real AppModule', async () => {
  const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
  expect(ref.get(AdminCatalogService)).toBeDefined();
  expect(ref.get(AdminOpsService)).toBeDefined();
  expect(ref.get(EditionAlertsService)).toBeDefined();
  const app = ref.createNestApplication({ logger: ['error'] });
  await app.init();
  const server = app.getHttpServer();
  const routes: string[] = [];
  const router = (app.getHttpAdapter().getInstance() as { _router?: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }; router?: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] } });
  const stack = (router._router ?? router.router)?.stack ?? [];
  for (const l of stack) if (l.route && l.route.path.startsWith('/admin')) routes.push(`${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
  console.log(routes.join('\n'));
  void server;
  await app.close();
}, 60000);
