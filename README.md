# Academia Aristóteles — Backend

NestJS, Prisma y PostgreSQL. Todas las rutas usan el prefijo `/api`.

## Inicio local

Desde la raíz del proyecto:

```bash
docker compose up -d postgres
cd aristoteles_be
npm install
cp .env.example .env # solo si no existe
```

Configura `DATABASE_URL` y `JWT_SECRET` en `.env`. Genera un secreto con `openssl rand -hex 32` y coloca el resultado en `JWT_SECRET`; se requieren al menos 32 caracteres. El archivo `.env` está ignorado por Git.

```bash
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

El seed crea `admin` / `admin2026` con rol `ADMIN`, sin duplicarlo ni restablecer su contraseña al ejecutarlo de nuevo. Las contraseñas se almacenan con scrypt y una sal aleatoria. Cambia las credenciales iniciales antes de usar una base de producción.

## Autenticación y permisos

- `POST /api/auth/login`: JSON `{ "username": "admin", "password": "admin2026", "role": "ADMIN" }`.
- `POST /api/auth/logout`: elimina la cookie del navegador.
- `GET /api/auth/me`: usuario autenticado, sin hash.
- `GET /api/admin/users` y `POST /api/admin/users`: solo `ADMIN`. La creación recibe `fullName`, `username`, `password` y `role`.
- `GET /api/dashboard`: solo `STUDENT`; conserva el dashboard y sus datos de demostración existentes. La asignación de cursos por cuenta todavía no forma parte de este módulo.

Todas las escrituras deben enviar `Content-Type: application/json` y `X-Requested-With: Aristoteles`. El frontend ya lo hace. No se habilita CORS: usa el proxy de Vite durante desarrollo y un proxy del mismo origen en producción.

El JWT dura ocho horas y se guarda en una cookie HTTP-only, SameSite=Strict, con ruta `/api`. En producción configura `NODE_ENV=production` y HTTPS para la cookie Secure. Cada solicitud consulta el rol y estado actuales en la base de datos. El logout elimina la cookie; no existe un registro de revocación de JWT en esta primera implementación.

## Verificación

```bash
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Las pruebas e2e requieren la base migrada y el seed. Crean cuentas con un prefijo aleatorio y las eliminan al terminar. Cubren autenticación, restauración, roles incorrectos, cuentas inactivas, hashes, unicidad, cookies y permisos de administración.
