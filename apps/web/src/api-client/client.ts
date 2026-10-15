import createClient from "openapi-fetch";
import type { paths } from "./schema";

/**
 * Typed REST client generated from the API's OpenAPI contract.
 * Same-origin requests keep the session cookie flowing through the Vite
 * proxy in development and the reverse proxy in deployment.
 */
export const api = createClient<paths>({
  baseUrl: "/",
  credentials: "include",
});
