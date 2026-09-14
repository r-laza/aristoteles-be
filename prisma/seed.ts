import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/auth/password';

const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: await hashPassword('admin2026'),
      fullName: 'Administrador',
      role: 'ADMIN',
      isActive: true,
    },
  });
  const student = await prisma.student.upsert({
    where: { name: 'Carlos Sánchez' },
    update: {},
    create: {
      name: 'Carlos Sánchez',
      initials: 'CS',
    },
  });

  const math = await prisma.course.upsert({
    where: { name: 'Matemática' },
    update: {},
    create: {
      name: 'Matemática',
      teacher: 'Laura Méndez',
      image: '/images/course-matematica.jpg',
    },
  });

  const communication = await prisma.course.upsert({
    where: { name: 'Comunicación' },
    update: {},
    create: {
      name: 'Comunicación',
      teacher: 'Rafael Torres',
      image: '/images/course-comunicacion.jpg',
    },
  });

  const physics = await prisma.course.upsert({
    where: { name: 'Física' },
    update: {},
    create: {
      name: 'Física',
      teacher: 'Andrea Castillo',
      image: '/images/course-fisica.jpg',
    },
  });

  await prisma.enrollment.upsert({
    where: {
      studentId_courseId: {
        studentId: student.id,
        courseId: math.id,
      },
    },
    update: { progress: 70 },
    create: { studentId: student.id, courseId: math.id, progress: 70 },
  });

  await prisma.enrollment.upsert({
    where: {
      studentId_courseId: {
        studentId: student.id,
        courseId: communication.id,
      },
    },
    update: { progress: 45 },
    create: { studentId: student.id, courseId: communication.id, progress: 45 },
  });

  await prisma.enrollment.upsert({
    where: {
      studentId_courseId: {
        studentId: student.id,
        courseId: physics.id,
      },
    },
    update: { progress: 20 },
    create: { studentId: student.id, courseId: physics.id, progress: 20 },
  });

  const taskBaseDate = new Date();
  taskBaseDate.setHours(18, 0, 0, 0);

  const tasks = [
    {
      courseId: math.id,
      title: 'Práctica de funciones',
      dueAt: new Date(taskBaseDate.getTime() + 86400000),
      status: 'pending',
    },
    {
      courseId: communication.id,
      title: 'Ensayo argumentativo',
      dueAt: new Date(taskBaseDate.getTime() + 172800000),
      status: 'pending',
    },
    {
      courseId: physics.id,
      title: 'Informe de laboratorio',
      dueAt: new Date(taskBaseDate.getTime() + 259200000),
      status: 'pending',
    },
    {
      courseId: math.id,
      title: 'Cuestionario de álgebra',
      dueAt: new Date(taskBaseDate.getTime() + 432000000),
      status: 'pending',
    },
  ];

  for (const task of tasks) {
    if (
      !(await prisma.task.findFirst({
        where: { courseId: task.courseId, title: task.title },
      }))
    ) {
      await prisma.task.create({ data: task });
    }
  }

  const activityItems = [
    {
      studentId: student.id,
      courseId: math.id,
      title: 'Completaste la lección de ecuaciones',
    },
    {
      studentId: student.id,
      courseId: communication.id,
      title: 'Publicaste tu actividad de debate',
    },
    {
      studentId: student.id,
      courseId: physics.id,
      title: 'Revisaste la guía de movimiento',
    },
    {
      studentId: student.id,
      courseId: math.id,
      title: 'Subiste una tarea de repaso',
    },
  ];

  for (const item of activityItems) {
    if (!(await prisma.activity.findFirst({ where: item }))) {
      await prisma.activity.create({ data: item });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
