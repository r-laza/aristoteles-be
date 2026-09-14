import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/roles.guard';
import { CyclesService } from './cycles.service';

@Controller('admin/cycles')
@Roles('ADMIN')
export class CyclesController {
  constructor(private readonly cycles: CyclesService) {}
  @Get() list() {
    return this.cycles.list();
  }
  @Post() create(@Body() body: unknown) {
    return this.cycles.create(body);
  }
  @Get(':id') detail(@Param('id', ParseIntPipe) id: number) {
    return this.cycles.detail(id);
  }
  @Get(':id/groups') groups(@Param('id', ParseIntPipe) id: number) {
    return this.cycles.groups(id);
  }
  @Post(':id/groups') createGroup(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.cycles.createGroup(id, body);
  }
  @Get(':id/available-students') available(
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.cycles.available(id);
  }
  @Get(':id/enrollments') enrollments(@Param('id', ParseIntPipe) id: number) {
    return this.cycles.enrollments(id);
  }
  @Post(':id/enrollments') enroll(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.cycles.enroll(id, body);
  }
}
@Module({ controllers: [CyclesController], providers: [CyclesService] })
export class CyclesModule {}
