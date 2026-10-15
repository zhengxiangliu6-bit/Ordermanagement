import { describe, expect, it } from 'vitest';
import {
  CarrierApiRegistry,
  CarrierApiNotConfiguredError,
} from './carrier-api';
import { StallionCarrierApiClient } from './stallion.client';
import { ChitchatsCarrierApiClient } from './chitchats.client';

describe('carrier-api reserved framework', () => {
  it('registers the reserved clients under their carrier keys', () => {
    const registry = new CarrierApiRegistry([
      new StallionCarrierApiClient(),
      new ChitchatsCarrierApiClient(),
    ]);
    expect(registry.resolve('stallion')).toBeInstanceOf(StallionCarrierApiClient);
    expect(registry.resolve('chitchats')).toBeInstanceOf(ChitchatsCarrierApiClient);
    expect(registry.resolve('sf-express')).toBeNull();
  });

  it('fails fast with CarrierApiNotConfiguredError until integrated', async () => {
    const stallion = new StallionCarrierApiClient();
    await expect(stallion.createShipment()).rejects.toBeInstanceOf(
      CarrierApiNotConfiguredError,
    );
    const chitchats = new ChitchatsCarrierApiClient();
    await expect(chitchats.fetchTracking()).rejects.toThrow(/not configured/);
  });
});
