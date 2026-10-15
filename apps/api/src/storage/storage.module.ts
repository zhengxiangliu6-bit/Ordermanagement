import { Provider } from '@nestjs/common';
import { join } from 'node:path';
import { LocalVolumeDriver } from './local-volume.driver';
import { STORAGE_DRIVER } from './storage.types';

/**
 * Local persistent volume driver (architecture §2.1: attachment contents on
 * a persistent server volume, metadata in PostgreSQL). ATTACHMENTS_DIR is
 * mounted from the deploy compose file in production.
 */
export const storageDriverProvider: Provider = {
  provide: STORAGE_DRIVER,
  useFactory: () =>
    new LocalVolumeDriver(
      process.env.ATTACHMENTS_DIR ?? join(process.cwd(), 'data', 'attachments'),
    ),
};
