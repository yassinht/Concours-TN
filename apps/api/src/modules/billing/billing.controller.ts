import { Body, Controller, Get, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { CheckoutInput, ManualProofInput } from '@ctn/shared';
import { CurrentUser, RegisteredGuard } from '../../common/auth.guards';
import type { SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { RateLimit } from '../auth/rate-limit';
import { BillingService } from './billing.service';

const PromoValidateBody = z.object({ code: z.string().trim().min(1).max(40), planCode: z.string().min(1).max(40) });
type PromoValidateBody = z.infer<typeof PromoValidateBody>;
type ManualProofBody = z.infer<typeof ManualProofInput>;

/** Webhook bodies are optional and loosely typed: they only point at a payment, which is then verified with the provider. */
const WebhookBody = z.record(z.unknown()).optional().catch(undefined);
type WebhookBody = z.infer<typeof WebhookBody>;

@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('plans')
  plans() {
    return this.billing.plans();
  }

  /** Which payment methods are configured here, so the paywall only offers working ones. */
  @Get('providers')
  providers() {
    return this.billing.availableProviders();
  }

  @Post('promo/validate')
  @HttpCode(200)
  @UseGuards(RegisteredGuard, RateLimit(20))
  validatePromo(@Body(new ZodPipe(PromoValidateBody)) body: PromoValidateBody, @CurrentUser() user: SessionUser) {
    return this.billing.validatePromo(user.id, body.code, body.planCode);
  }

  @Post('checkout')
  @UseGuards(RegisteredGuard, RateLimit(10))
  checkout(@Body(new ZodPipe(CheckoutInput)) body: CheckoutInput, @CurrentUser() user: SessionUser) {
    return this.billing.checkout(user.id, body);
  }

  @Post('manual-proof')
  @HttpCode(200)
  @UseGuards(RegisteredGuard, RateLimit(10))
  manualProof(@Body(new ZodPipe(ManualProofInput)) body: ManualProofBody, @CurrentUser() user: SessionUser) {
    return this.billing.manualProof(user.id, body.paymentId, body.reference);
  }

  @Get('me')
  @UseGuards(RegisteredGuard)
  me(@CurrentUser() user: SessionUser) {
    return this.billing.me(user.id);
  }

  /** Landing URL after a provider page: verified server-side, then 302 to the web app's result page. */
  @Get('return')
  @UseGuards(RateLimit(60))
  async return(@Query('paymentId') paymentId: unknown, @Res() res: Response) {
    const url = await this.billing.handleReturn(paymentId);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, url);
  }

  @Get('webhooks/konnect')
  @UseGuards(RateLimit(120, 60_000, 'webhook-konnect'))
  konnectGet(@Query('payment_ref') ref: unknown) {
    return this.billing.konnectWebhook(ref);
  }

  @Post('webhooks/konnect')
  @HttpCode(200)
  @UseGuards(RateLimit(120, 60_000, 'webhook-konnect'))
  konnectPost(@Query('payment_ref') ref: unknown, @Body(new ZodPipe(WebhookBody)) body: WebhookBody) {
    return this.billing.konnectWebhook(typeof ref === 'string' ? ref : body?.payment_ref ?? body?.paymentRef);
  }

  @Post('webhooks/flouci')
  @HttpCode(200)
  @UseGuards(RateLimit(120, 60_000, 'webhook-flouci'))
  flouciPost(
    @Query('payment_id') qPaymentId: unknown,
    @Query('developer_tracking_id') qTracking: unknown,
    @Body(new ZodPipe(WebhookBody)) body: WebhookBody,
  ) {
    return this.billing.flouciWebhook({
      paymentId: qPaymentId ?? body?.payment_id ?? body?.paymentId,
      trackingId: qTracking ?? body?.developer_tracking_id,
    });
  }
}
