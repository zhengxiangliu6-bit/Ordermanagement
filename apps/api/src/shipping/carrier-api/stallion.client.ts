import {
  CarrierApiNotConfiguredError,
  type CarrierApiClient,
} from './carrier-api';

/**
 * Stallion Express (Canada) API client — reserved stub.
 *
 * API v5 covers quoting rates, creating shipments, purchasing labels,
 * scheduling pickups, and tracking parcels. Documentation:
 * https://docs.stallion.ca
 *
 * Authentication is an account API key (header-based). Integration TODO:
 * developer account + key in env, HTTP client, label download, tracking
 * sync into the Tracking Provider surface.
 */
export class StallionCarrierApiClient implements CarrierApiClient {
  readonly carrierKey = 'stallion';

  async quotes(): Promise<never> {
    throw new CarrierApiNotConfiguredError(this.carrierKey);
  }

  async createShipment(): Promise<never> {
    throw new CarrierApiNotConfiguredError(this.carrierKey);
  }

  async fetchTracking(): Promise<never> {
    throw new CarrierApiNotConfiguredError(this.carrierKey);
  }
}
