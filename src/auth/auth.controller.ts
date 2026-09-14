import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { AuthService } from './auth.service';
import { Public } from './auth.guard';
import { AUTH_COOKIE, SESSION_SECONDS } from './auth.types';
import type { AuthRequest } from './auth.types';

const cookieOptions = (): CookieOptions => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  path: '/api',
});
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { token, user } = await this.auth.login(body);
    response.cookie(AUTH_COOKIE, token, {
      ...cookieOptions(),
      maxAge: SESSION_SECONDS * 1000,
    });
    return user;
  }
  @Public()
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie(AUTH_COOKIE, cookieOptions());
  }
  @Get('me')
  me(@Req() request: AuthRequest) {
    return request.user;
  }
}
