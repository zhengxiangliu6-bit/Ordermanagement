import {
  CarrierApiNotConfiguredError,
  type CarrierApiClient,
} from './carrier-api';

/**
 * Chit Chats (Canada) API client — reserved stub.
 *
 * API v1 covers shipments, labels, batches, and tracking; authentication
 * uses a Client ID plus an API access token, and public tracking is
 * exposed as JSON. Documentation: https://chitchats.com/docs/api/v1
 *
 * Integration TODO: developer account + token in env, HTTP client, label
 * download, tracking sync into the Tracking Provider surface.
 */
export class ChitchatsCarrierApiClient implements CarrierApiClient {
  readonly carrierKey = 'chitchats';

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
