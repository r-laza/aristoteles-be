import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { DashboardDto } from './dashboard.types';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(): Promise<DashboardDto> {
    const student = await this.prisma.student.findFirst({
      where: { name: 'Carlos Sánchez' },
      include: {
        enrollments: {
          include: {
            course: true,
          },
        },
      },
    });

    if (!student) {
      throw new Error('Student not found');
    }

    const courses = student.enrollments.map((enrollment) => ({
      id: enrollment.course.id,
      name: enrollment.course.name,
      teacher: enrollment.course.teacher,
      progress: enrollment.progress,
      image: enrollment.course.image,
    }));

    const pendingTasks = await this.prisma.task.findMany({
      where: { status: 'pending' },
      orderBy: { dueAt: 'asc' },
      include: { course: true },
      take: 4,
    });

    const nextClass = courses[0] ?? { name: 'Sin clases', teacher: '', progress: 0, image: '', id: 0 };
    const nextClassDate = pendingTasks[0]?.dueAt ?? new Date();

    const recentActivity = await this.prisma.activity.findMany({
      where: { studentId: student.id },
      orderBy: { createdAt: 'desc' },
      include: { course: true },
      take: 4,
    });

    return {
      student: {
        id: student.id,
        name: student.name,
        initials: student.initials,
      },
      summary: {
        activeCourses: courses.length,
        pendingTasks: pendingTasks.length,
        nextClass: {
          course: nextClass.name,
          startsAt: nextClassDate.toISOString(),
        },
      },
      courses,
      upcomingTasks: pendingTasks.map((task) => ({
        id: task.id,
        title: task.title,
        course: task.course.name,
        dueAt: task.dueAt.toISOString(),
      })),
      recentActivity: recentActivity.map((item) => ({
        id: item.id,
        title: item.title,
        course: item.course?.name ?? 'General',
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }
}
