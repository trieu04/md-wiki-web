import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from '../prisma/prisma.module.js';
import { WikiModule } from '../wiki/wiki.module.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { PermissionGuard } from './auth-http.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';

@Module({
  imports: [PrismaModule, WikiModule],
  controllers: [AuthController, AdminController],
  providers: [AuthService, AdminService, { provide: APP_GUARD, useClass: PermissionGuard }],
  exports: [AuthService],
})
export class IdentityModule {}
