export type StudentSummary = {
  id: number;
  name: string;
  initials: string;
};

export type SummaryCard = {
  activeCourses: number;
  pendingTasks: number;
  nextClass: {
    course: string;
    startsAt: string;
  };
};

export type CourseDto = {
  id: number;
  name: string;
  teacher: string;
  progress: number;
  image: string;
};

export type UpcomingTaskDto = {
  id: number;
  title: string;
  course: string;
  dueAt: string;
};

export type RecentActivityDto = {
  id: number;
  title: string;
  course: string;
  createdAt: string;
};

export type DashboardDto = {
  student: StudentSummary;
  summary: SummaryCard;
  courses: CourseDto[];
  upcomingTasks: UpcomingTaskDto[];
  recentActivity: RecentActivityDto[];
};
