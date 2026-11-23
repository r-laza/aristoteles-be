# Voucher storage deployment

New voucher keys use this provider-independent layout:

`aristoteles/cycles/{cycle-name}/estudiantes/{student-name}/voucher-{sequence}.{extension}`

Folder names are sanitized for local filesystem safety. When sanitized cycle or
student names collide, the corresponding stable database ID is appended. The
`VoucherCounter` table allocates each student's sequence atomically, and S3
conditional writes plus local exclusive creation prevent overwrites.

Run the Prisma migration before deploying the new application. It adds the
nullable `paymentEvidenceStorage` column; it does not rewrite or delete payment
records. The later voucher-counter migration adds only the sequence table and
also does not rewrite payment records or existing object keys.

Legacy rows intentionally retain a null storage value and their existing
`payment-evidence/...` key. They are read from the provider selected by
`NODE_ENV`: development and test use local storage, while production uses S3.
They remain accessible when the deployment continues using the same provider.
Previously generated UUID keys under
`aristoteles/cycles/cycle-.../students/.../vouchers/...` also remain unchanged
and accessible through their stored database references. This deployment does
not list, move, rename, or delete historical objects.

When changing an existing deployment from local storage to S3, copy the legacy
objects from `uploads/payment-evidence/` into the bucket with the same relative
keys before deploying with `NODE_ENV=production`. Do not move or rename them.
Verify retrieval through the authenticated evidence endpoint, then retain a
backup until verification is complete. Existing database rows need no update.
