import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ForgotPasswordInput, LoginInput, MagicLinkInput, RegisterInput, ResetPasswordInput, type Locale } from '@ctn/shared';
import { CurrentUser, RegisteredGuard } from '../../common/auth.guards';
import type { SessionUser } from '../../common/session';
import { ZodPipe } from '../../common/zod.pipe';
import { AuthService } from './auth.service';
import { GoogleOAuthService } from './google-oauth.service';
import { RateLimit } from './rate-limit';

/** Per IP per route and minute on credential endpoints (configurable for carrier-grade NAT deployments). */
const AUTH_LIMIT = Number(process.env.AUTH_RATE_LIMIT_PER_MIN) || 10;

const GuestBody = z.object({ locale: z.enum(['ar', 'fr']).optional() }).optional();
const ChangePasswordBody = z.object({
  currentPassword: z.string().min(1).max(200).optional(),
  newPassword: z.string().min(8).max(200),
});

/** Locale the visitor already chose on the website (cookie set by the web app). */
function cookieLocale(req: Request): Locale | undefined {
  const v = (req as Request & { cookies?: Record<string, string> }).cookies?.ctn_lang;
  return v === 'ar' || v === 'fr' ? v : undefined;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly google: GoogleOAuthService,
  ) {}

  @Post('guest')
  @HttpCode(200)
  @UseGuards(RateLimit(60))
  guest(
    @Body(new ZodPipe(GuestBody)) body: z.infer<typeof GuestBody>,
    @CurrentUser() session: SessionUser | null,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.guest(session, body?.locale ?? cookieLocale(req), res);
  }

  @Post('register')
  @HttpCode(200)
  @UseGuards(RateLimit(AUTH_LIMIT))
  register(
    @Body(new ZodPipe(RegisterInput)) body: RegisterInput,
    @CurrentUser() session: SessionUser | null,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.register(session, body, res, cookieLocale(req));
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(RateLimit(AUTH_LIMIT))
  login(
    @Body(new ZodPipe(LoginInput)) body: LoginInput,
    @CurrentUser() session: SessionUser | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.login(session, body, res);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    return this.auth.logout(res);
  }

  @Get('me')
  me(@CurrentUser() session: SessionUser | null, @Res({ passthrough: true }) res: Response) {
    return this.auth.currentUser(session, res);
  }

  @Post('magic-link')
  @HttpCode(200)
  @UseGuards(RateLimit(AUTH_LIMIT))
  magicLink(@Body(new ZodPipe(MagicLinkInput)) body: z.infer<typeof MagicLinkInput>) {
    return this.auth.requestMagicLink(body.email);
  }

  @Get('magic/:token')
  @UseGuards(RateLimit(30))
  async consumeMagicLink(@Param('token') token: string, @CurrentUser() session: SessionUser | null, @Res() res: Response) {
    const target = await this.auth.consumeMagicLink(token, session, res);
    res.redirect(302, target);
  }

  @Post('password/forgot')
  @HttpCode(200)
  @UseGuards(RateLimit(AUTH_LIMIT))
  forgot(@Body(new ZodPipe(ForgotPasswordInput)) body: z.infer<typeof ForgotPasswordInput>) {
    return this.auth.forgotPassword(body.email);
  }

  @Post('password/reset')
  @HttpCode(200)
  @UseGuards(RateLimit(AUTH_LIMIT))
  reset(
    @Body(new ZodPipe(ResetPasswordInput)) body: z.infer<typeof ResetPasswordInput>,
    @CurrentUser() session: SessionUser | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.auth.resetPassword(body.token, body.password, session, res);
  }

  /** Extra: change (or first set, for Google / magic-link accounts) the password. */
  @Post('password/change')
  @HttpCode(200)
  @UseGuards(RegisteredGuard, RateLimit(AUTH_LIMIT))
  changePassword(@Body(new ZodPipe(ChangePasswordBody)) body: z.infer<typeof ChangePasswordBody>, @CurrentUser() user: SessionUser) {
    return this.auth.changePassword(user.id, body.currentPassword, body.newPassword);
  }

  /** Extra: email confirmation link sent with the welcome email. */
  @Get('verify/:token')
  @UseGuards(RateLimit(30))
  async verifyEmail(@Param('token') token: string, @Res() res: Response) {
    res.redirect(302, await this.auth.verifyEmail(token));
  }

  @Post('verify/resend')
  @HttpCode(200)
  @UseGuards(RegisteredGuard, RateLimit(5))
  resendVerification(@CurrentUser() user: SessionUser) {
    return this.auth.resendVerification(user.id);
  }

  @Get('google')
  googleStart(@Query('next') next: unknown, @Res() res: Response) {
    res.redirect(302, this.google.start(res, next));
  }

  @Get('google/callback')
  @UseGuards(RateLimit(30))
  async googleCallback(@CurrentUser() session: SessionUser | null, @Req() req: Request, @Res() res: Response) {
    const target = await this.google.callback(req, res, session, cookieLocale(req));
    res.redirect(302, target);
  }
}
