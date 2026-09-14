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

## Ciclos académicos, grupos e inscripciones

El módulo usa PostgreSQL. Tras actualizar: `npx prisma generate` y `npx prisma migrate deploy`.

Todas estas rutas requieren `ADMIN`:

- `GET/POST /api/admin/cycles`: listar y crear ciclos (`name`, `startDate`, `endDate`, `baseEnrollmentAmount`). Las fechas usan `YYYY-MM-DD` y los importes admiten dos decimales.
- `GET /api/admin/cycles/:id`: ciclo con cantidades de grupos e inscritos.
- `GET/POST /api/admin/cycles/:id/groups`: listar y crear grupos (`name`).
- `GET /api/admin/cycles/:id/available-students`: estudiantes activos aún no inscritos en ese ciclo.
- `GET/POST /api/admin/cycles/:id/enrollments`: listar e inscribir (`studentId`, `groupId`, `discountAmount` opcional y `discountReason` opcional).

`Enrollment` relaciona `User`, `AcademicCycle` y `Group`; no se agregan ciclo ni grupo a `User`. El importe base se copia del ciclo y el total se calcula en el servidor con Decimal. La base de datos impide duplicar estudiante/ciclo, asignar grupos de otro ciclo y almacenar importes inconsistentes. No se implementan pagos.

La relación histórica entre alumnos de demostración y cursos se llama ahora `CourseEnrollment` en Prisma y conserva su tabla original `Enrollment`. Las matrículas académicas usan la tabla `AcademicEnrollment`, sin borrar datos del dashboard estudiantil.

`npm run test:e2e -- --runInBand` incluye pruebas del módulo, duplicados concurrentes, descuentos y permisos. Sus datos temporales se eliminan al finalizar.

## Gestión de pagos

Los pagos pertenecen a `Enrollment`, no a `User`. Aplica las migraciones y regenera Prisma como se indica arriba.

Rutas protegidas para `ADMIN`:

- `GET /api/admin/payments/cycles/:id`: inscripciones del ciclo con importes y totales agregados.
- `POST /api/admin/payments/enrollments/:id`: registra un pago. JSON: `amount`, `paymentDate` (`YYYY-MM-DD`), `paymentMethod` (`CASH`, `TRANSFER`, `CARD`, `OTHER`), `reference` y `notes` opcionales.
- `GET /api/admin/payments/enrollments/:id`: historial ordenado por fecha de pago descendente.

El total exigible es `Enrollment.finalAmount`; el saldo resta la suma de pagos registrados. Los estados `PENDING`, `PARTIAL` y `PAID` se calculan al consultar. Importes con Decimal y hasta dos decimales, estrictamente positivos. Un bloqueo de fila dentro de la transacción serializa pagos simultáneos de la misma inscripción e impide exceder el saldo. Los pagos no modifican la matrícula base ni los descuentos.

Las pruebas e2e cubren permisos, pagos parciales/completos, precisión decimal, historial, sobrepagos y concurrencia.
