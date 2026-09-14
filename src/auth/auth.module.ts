import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { RolesGuard } from './roles.guard';
import { SESSION_SECONDS } from './auth.types';

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret || secret.length < 32)
          throw new Error('JWT_SECRET must contain at least 32 characters');
        return {
          secret,
          signOptions: {
            expiresIn: SESSION_SECONDS,
            algorithm: 'HS256',
            issuer: 'aristoteles',
            audience: 'aristoteles-web',
          },
          verifyOptions: {
            algorithms: ['HS256'],
            issuer: 'aristoteles',
            audience: 'aristoteles-web',
          },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
