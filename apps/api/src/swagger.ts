import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Builds the OpenAPI document shared by the Swagger UI and the export script. */
export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Order Management API')
    .setDescription(
      'Order Management System REST API (/api/v1). Authentication endpoints (sign-in/sign-out/get-session) are served by Better Auth outside this contract; use GET /api/v1/auth/me for the merged principal.',
    )
    .setVersion('0.1.0')
    .addCookieAuth('better-auth.session_token')
    .build();
  return SwaggerModule.createDocument(app, config);
}
