import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthGuard } from './auth.guard.js';
import { AuthService, type IssuedSession, type VerifyResult } from './auth.service.js';
import {
  clearSessionCookies,
  readCookie,
  REFRESH_COOKIE,
  wantsBearer,
  writeSessionCookies,
} from './cookies.js';
import {
  parseEmail,
  parseOtp,
  parseRefreshToken,
  parseRegistration,
  parseTimezone,
} from './validation.js';

type AuthedRequest = Request & { user: { id: string; sessionId: string } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post('request-otp')
  @HttpCode(200)
  async requestOtp(@Req() request: Request, @Body() body: unknown) {
    this.assertBrowserHeader(request);
    await this.auth.requestOtp(parseEmail(body), clientIp(request));
    return { status: 'code_sent' };
  }

  @Post('verify-otp')
  @HttpCode(200)
  async verifyOtp(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    this.assertBrowserHeader(request);
    const { email, code } = parseOtp(body);
    const result = await this.auth.verifyOtp(email, code, clientIp(request));
    return this.presentVerification(request, response, result);
  }

  @Post('complete-registration')
  @HttpCode(201)
  async completeRegistration(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    this.assertBrowserHeader(request);
    const { registrationToken, name } = parseRegistration(body);
    const session = await this.auth.completeRegistration(
      registrationToken,
      name,
      clientIp(request),
    );
    return this.present(request, response, session);
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    this.assertBrowserHeader(request);
    const refreshToken =
      parseRefreshToken(body) ??
      readCookie(request.header('cookie'), REFRESH_COOKIE);
    if (!refreshToken) {
      throw new UnauthorizedException('Sign in again.');
    }
    const session = await this.auth.refresh(refreshToken);
    return this.present(request, response, session);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ) {
    this.assertBrowserHeader(request);
    const refreshToken =
      parseRefreshToken(body) ??
      readCookie(request.header('cookie'), REFRESH_COOKIE);
    await this.auth.logout(refreshToken);
    clearSessionCookies(response, this.config);
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthedRequest) {
    return this.auth.currentUser(request.user.id);
  }

  @Patch('me')
  @UseGuards(AuthGuard)
  updateMe(@Req() request: AuthedRequest, @Body() body: unknown) {
    return this.auth.updateTimezone(request.user.id, parseTimezone(body));
  }

  private presentVerification(
    request: Request,
    response: Response,
    result: VerifyResult,
  ) {
    if (result.status === 'registration_required') {
      return {
        status: 'registration_required',
        email: result.email,
        registrationToken: result.registrationToken,
      };
    }
    const presented = this.present(request, response, result.session);
    return { status: 'authenticated', ...presented };
  }

  private assertBrowserHeader(request: Request) {
    if (!wantsBearer(request) && request.header('x-personal-ai') !== '1') {
      throw new ForbiddenException('Missing request header.');
    }
  }

  private present(
    request: Request,
    response: Response,
    session: IssuedSession,
  ) {
    if (wantsBearer(request)) {
      return session;
    }
    writeSessionCookies(response, this.config, session);
    return { user: session.user };
  }
}

function clientIp(request: Request): string {
  return request.ip || request.socket.remoteAddress || 'unknown';
}
