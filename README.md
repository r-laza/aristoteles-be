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
- `POST /api/auth/profile`: administradores actualizan únicamente su propio nombre, usuario y contraseña opcional. Cambiar el usuario o la contraseña requiere `currentPassword`; no acepta `id`, `role`, `adminLevel` ni `isActive`.
- `GET /api/admin/users` y `POST /api/admin/users`: solo `ADMIN`. La creación recibe `fullName`, `username`, `password` y `role`.
- `GET /api/dashboard`: solo `STUDENT`; conserva el dashboard y sus datos de demostración existentes. La asignación de cursos por cuenta todavía no forma parte de este módulo.

Todas las escrituras deben enviar `Content-Type: application/json` y `X-Requested-With: Aristoteles`. El frontend ya lo hace. No se habilita CORS: usa el proxy de Vite durante desarrollo y un proxy del mismo origen en producción.

### Niveles de administrador

Los dos niveles conservan el rol de inicio de sesión `ADMIN`: `adminLevel=MAIN` (Administrador principal) y `REGULAR` (Administrador). Ambos mantienen acceso al dashboard, inscripciones, pagos y configuración previamente autorizada. Solo un administrador principal activo puede crear o modificar cuentas de administrador mediante `/api/admin/users` o `/api/admin/people`, incluidos estado, rol, nivel y contraseña. Los administradores regulares pueden consultar la lista y seguir gestionando docentes y estudiantes. Las cuentas de administrador no se pueden modificar mediante los endpoints de acceso estudiantil.

La migración `20261127020000_administrator_levels` conserva todas las cuentas y promueve a **todos los administradores activos existentes** a `MAIN`; los nuevos administradores usan `REGULAR` por defecto. Los seeds crean el administrador inicial como `MAIN` y nunca restablecen cuentas existentes. Antes de aplicar la migración en una base con cuentas, debe existir al menos un administrador activo; de lo contrario, la migración se revierte sin activar cuentas automáticamente. Una base nueva vacía permite crear primero al administrador principal mediante el seed.

Las escrituras administrativas se serializan con un bloqueo transaccional; desactivar, degradar o cambiar el rol del último administrador principal activo devuelve `409` con código `LAST_MAIN_ADMINISTRATOR`. Un trigger diferido protege también actualizaciones y eliminaciones directas o concurrentes en PostgreSQL. El nivel se consulta desde la base en cada solicitud, no desde un permiso persistido en el JWT.

Después de revisar la migración, aplica `npx prisma migrate deploy` y regenera el cliente con `npx prisma generate` antes de arrancar el backend actualizado. Las pruebas HTTP aisladas se ejecutan con `npm test -- --runInBand admin/admin-permissions.spec.ts`; no modifican una base real.

El JWT dura ocho horas y se guarda en una cookie HTTP-only, SameSite=Strict, con ruta `/api`. En producción configura `NODE_ENV=production` y HTTPS para la cookie Secure. Cada solicitud consulta el rol y estado actuales en la base de datos. El logout elimina la cookie; no existe un registro de revocación de JWT en esta primera implementación.

## Analítica del dashboard administrativo

`GET /api/admin/dashboard` requiere `ADMIN` y acepta `branchId`, `cycleId` y `groupId` opcionales. La selección es jerárquica: sede, ciclo de esa sede y grupo reutilizable asignado al ciclo y sede. Sin sede explícita se conserva la primera sede; no existe una selección de todas las sedes.

La respuesta incluye `summary`, `enrollmentDistribution` (`school` y `preuniversity`), `monthlyCollected`, `paymentMethods` y `unrepresentedCollected` dentro de `dashboard`. Las inscripciones se cuentan por estudiante y los pagos por registro, usando importes Decimal. La categoría Escolar/Preuniversitario pertenece al ciclo: la categoría no seleccionada devuelve una distribución vacía. Los saldos pendientes y vencidos usan las obligaciones y reglas de pago existentes.

`paymentMethods` contiene únicamente `CASH`, `TRANSFER`, `YAPE` y `PLIN`. Los pagos históricos con otros métodos siguen incluidos en la recaudación total y en `unrepresentedCollected`; no se reasignan a métodos actuales. Las rutas de estudiantes morosos, pendientes, al día, detalle y exportación no cambian. Esta ampliación no requiere migraciones.

## Verificación

```bash
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Las pruebas e2e requieren la base migrada y el seed. Crean cuentas con un prefijo aleatorio y las eliminan al terminar. Cubren autenticación, restauración, roles incorrectos, cuentas inactivas, hashes, unicidad, cookies y permisos de administración.

## Ciclos académicos, grupos e inscripciones

El módulo usa PostgreSQL. Tras actualizar: `npx prisma generate` y `npx prisma migrate deploy`.

All cycle and catalog endpoints require `ADMIN`:

- `GET /api/admin/cycles`: list cycles and enrollment/group counts.
- `POST /api/admin/cycles` and `POST /api/admin/cycles/:id`: create or edit a complete cycle atomically. Body: `{ name, startDate, endDate, groups: [{ groupId, feeIds: [1] }] }`. Dates use `YYYY-MM-DD`; at least one group and exactly one fee per group are required. `groupId` here identifies a reusable group.
- `GET /api/admin/cycles/:id`: cycle metadata and counts.
- `GET/POST /api/admin/groups`: list/create reusable groups (`name`).
- `POST /api/admin/groups/:id`: rename a reusable group across its cycles.
- `POST /api/admin/groups/:id/delete`: delete an unused group; returns 409 if assigned to any cycle and 404 if missing. The group catalog includes `_count.cycles`. Groups currently have no inactive state; all catalog groups are available for assignment.
- `GET/POST /api/admin/fees`: list/create reusable enrollment fees (`name`, `amount`, `validFrom`, optional `validUntil`). Amounts allow up to two decimal places.
- `POST /api/admin/fees/:id`: edit a fee across its assignments. Existing enrollment amounts remain unchanged.
- `POST /api/admin/fees/:id/delete`: delete an unused fee. Returns 409 if group assignments or historical enrollments reference it, and 404 if missing. Deletion locks the fee row to protect concurrent assignments. The fee catalog includes `_count.cycleGroups` and `_count.enrollments` for usage and deletion feedback.
- `GET /api/admin/cycles/:id/groups`: list cycle assignments and their selected fees. The former group/fee creation endpoints under a cycle are replaced by the catalog and complete-cycle endpoints above.
- `GET /api/admin/cycles/:id/available-students`: active students not enrolled in this cycle.
- `GET/POST /api/admin/cycles/:id/enrollments`: list/enroll students (`studentId`, `groupId`: cycle assignment ID, `feeId`, optional `discountAmount` and `discountReason`).

`Group` and `EnrollmentFee` are independent reusable catalogs. `CycleGroup` relates a group to a cycle; its fee relationship stores exactly one selected matrícula for each group and cycle when creating or editing. The API retains the `feeIds` array format but rejects arrays whose length is not one. Assigning catalogs never copies their records. Cycle edits preserve existing assignment IDs. Groups with enrolled students cannot be removed (HTTP 409); the assigned fee can be replaced while historical enrollments retain their fee reference and stored amounts.

Enrollment validates the selected group's cycle and fee assignment, copies the fee amount, and computes the final amount with Decimal on the server. Fee validity includes both endpoints using the academy's calendar date (`America/Lima`). Database constraints prevent duplicate group/cycle and student/cycle relationships and inconsistent stored amounts.

Migration `20260916000000_reusable_fees` moves existing fee assignments into the join table without changing fee IDs, enrollment amounts, or payments. Existing fees are retained individually, since matching names or prices do not establish that they are the same business entity.

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
