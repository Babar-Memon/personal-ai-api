import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { ACCESS_COOKIE, bearerToken, readCookie } from './cookies.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token =
      bearerToken(request) ??
      readCookie(request.header('cookie'), ACCESS_COOKIE);
    request.user = await this.auth.verifyAccess(token);
    return true;
  }
}
