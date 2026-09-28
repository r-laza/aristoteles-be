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
  @Post(':id/groups') addGroup(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.cycles.addCycleGroup(id, body);
  }
  @Post(':id/groups/:groupId/delete') deleteGroup(
    @Param('id', ParseIntPipe) id: number,
    @Param('groupId', ParseIntPipe) groupId: number,
  ) {
    return this.cycles.deleteCycleGroup(id, groupId);
  }
  @Post(':id/delete') delete(@Param('id', ParseIntPipe) id: number) {
    return this.cycles.deleteCycle(id);
  }
  @Post(':id') edit(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.cycles.create(body, id);
  }
  @Post(':id/details') editDetails(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.cycles.updateDetails(id, body);
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
@Controller('admin/groups')
@Roles('ADMIN')
export class GroupsController {
  constructor(private readonly cycles: CyclesService) {}
  @Get() list() {
    return this.cycles.reusableGroups();
  }
  @Post() create(@Body() body: unknown) {
    return this.cycles.saveGroup(body);
  }
  @Post(':id/delete') delete(@Param('id', ParseIntPipe) id: number) {
    return this.cycles.deleteGroup(id);
  }
  @Post(':id') edit(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.cycles.saveGroup(body, id);
  }
}
@Controller('admin/fees')
@Roles('ADMIN')
export class FeesController {
  constructor(private readonly cycles: CyclesService) {}
  @Get() list() {
    return this.cycles.reusableFees();
  }
  @Post() create(@Body() body: unknown) {
    return this.cycles.saveFee(body);
  }
  @Post(':id/delete') delete(@Param('id', ParseIntPipe) id: number) {
    return this.cycles.deleteFee(id);
  }
  @Post(':id') edit(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.cycles.saveFee(body, id);
  }
}
@Controller('admin/pensions')
@Roles('ADMIN')
export class PensionsController {
  constructor(private readonly cycles: CyclesService) {}
  @Get() list() {
    return this.cycles.reusablePensions();
  }
  @Post() create(@Body() body: unknown) {
    return this.cycles.savePension(body);
  }
  @Post(':id/delete') delete(@Param('id', ParseIntPipe) id: number) {
    return this.cycles.deletePension(id);
  }
  @Post(':id') edit(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.cycles.savePension(body, id);
  }
}
@Module({
  controllers: [
    CyclesController,
    GroupsController,
    FeesController,
    PensionsController,
  ],
  providers: [CyclesService],
})
export class CyclesModule {}
