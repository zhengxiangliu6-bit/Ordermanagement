import { ApiProperty } from '@nestjs/swagger';

/**
 * Authenticated principal returned by the API and attached to requests.
 * Identity comes from Better Auth; roles/permissions come from
 * Order Management's own RBAC tables.
 */
export class AuthUser {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({ example: 'admin@example.com', type: String })
  email: string;

  @ApiProperty({ example: 'Administrator', type: String })
  displayName: string;

  /** Flattened `scope:action` permission keys from every assigned role. */
  @ApiProperty({ type: [String], example: ['orders:read', 'items:read'] })
  permissions: string[];

  @ApiProperty({ type: Boolean })
  isActive: boolean;

  /** True when an administrator issued a one-time password that must be changed. */
  @ApiProperty({ type: Boolean })
  mustChangePassword: boolean;
}
