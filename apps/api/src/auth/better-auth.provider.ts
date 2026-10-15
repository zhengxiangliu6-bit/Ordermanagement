import { Provider } from '@nestjs/common';
import { createAuth } from './better-auth';
import { PrismaService } from '../prisma/prisma.service';

export const BETTER_AUTH = 'BETTER_AUTH';

export const betterAuthProvider: Provider = {
  provide: BETTER_AUTH,
  useFactory: async (prisma: PrismaService) => createAuth(prisma),
  inject: [PrismaService],
};
