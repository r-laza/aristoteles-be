import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { Request, Response, NextFunction } from 'express';

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    // All browser writes require JSON and a custom header, blocking cross-site forms.
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      (request.get('X-Requested-With') !== 'Aristoteles' ||
        !request.is('application/json'))
    ) {
      response.status(403).json({ message: 'Forbidden' });
      return;
    }
    next();
  });
}
