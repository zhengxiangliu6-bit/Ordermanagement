import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Carrier, Prisma } from '@prisma/client';
import {
  CarrierRuleSet,
  InvalidRuleError,
  matchCarriers,
  previewForCarrier,
  findTransformCollisions,
  validateAttakyTransform,
  validateRecognition,
  type PreviewOutcome,
} from './carrier-rules';
import { PrismaService } from '../prisma/prisma.service';
import { ShippingSettingsService } from './shipping-settings.service';
import { displayTrackingUrl, readTrackingJump } from './tracking-jump';
import { CarrierInputDto } from './dto/carrier.dto';

interface StoredRecognition {
  regexes: string[];
  normalization?: { stripSpaces?: boolean; uppercase?: boolean };
  priority?: number;
}

interface StoredTransform {
  rules: Array<{ pattern: string; replacement: string }>;
  version: number;
}

function toRuleSet(carrier: Carrier): CarrierRuleSet {
  return {
    key: carrier.key,
    name: carrier.name,
    enabled: carrier.enabled,
    recognition: (carrier.recognition ?? {}) as unknown as StoredRecognition,
    trackingUrlTemplate: carrier.trackingUrlTemplate,
    attakyTransform: (carrier.attakyTransform ?? null) as unknown as StoredTransform | null,
  };
}

@Injectable()
export class CarrierService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: ShippingSettingsService,
  ) {}

  list(): Promise<Carrier[]> {
    return this.prisma.carrier.findMany({ orderBy: { createdAt: 'asc' } });
  }

  async create(dto: CarrierInputDto): Promise<Carrier> {
    this.validateRules(dto);
    const existing = await this.prisma.carrier.findUnique({
      where: { key: dto.key },
    });
    if (existing) {
      throw new BadRequestException('Carrier key already exists.');
    }
    return this.prisma.carrier.create({
      data: {
        key: dto.key,
        name: dto.name,
        enabled: dto.enabled ?? true,
        recognition: dto.recognition as unknown as Prisma.InputJsonValue,
        trackingUrlTemplate: dto.trackingUrlTemplate ?? null,
        crossBorder: dto.crossBorder ?? false,
        orderUrlTemplate: dto.orderUrlTemplate ?? null,
        attakyTransform: (dto.attakyTransform ?? null) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async update(id: string, dto: CarrierInputDto): Promise<Carrier> {
    this.validateRules(dto);
    const carrier = await this.prisma.carrier.findUnique({ where: { id } });
    if (!carrier) throw new NotFoundException('Carrier not found.');

    // Rule history / effective versioning (§12.4): recognition and transform
    // changes must bump the transform version; shipped shipments keep the
    // values captured when they were prepared.
    if (dto.attakyTransform && carrier.attakyTransform) {
      const previous = carrier.attakyTransform as unknown as StoredTransform;
      if (dto.attakyTransform.version <= previous.version) {
        throw new BadRequestException(
          'Changing transformation rules requires a higher version.',
        );
      }
    }
    return this.prisma.carrier.update({
      where: { id },
      data: {
        key: dto.key,
        name: dto.name,
        enabled: dto.enabled ?? carrier.enabled,
        recognition: dto.recognition as unknown as Prisma.InputJsonValue,
        trackingUrlTemplate: dto.trackingUrlTemplate ?? null,
        crossBorder: dto.crossBorder ?? carrier.crossBorder,
        orderUrlTemplate: dto.orderUrlTemplate ?? null,
        attakyTransform: (dto.attakyTransform ?? null) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async remove(id: string): Promise<void> {
    const carrier = await this.prisma.carrier.findUnique({
      where: { id },
      include: { _count: { select: { shipments: true } } },
    });
    if (!carrier) throw new NotFoundException('Carrier not found.');
    if (carrier._count.shipments > 0) {
      throw new BadRequestException(
        'Carrier has shipments recorded; disable it instead of deleting.',
      );
    }
    await this.prisma.carrier.delete({ where: { id } });
  }

  /** §12.3: normalize → match → preview. Ambiguity is reported, never silently resolved. */
  async preview(
    trackingNumber: string,
    carrierId?: string,
  ): Promise<
    | {
        kind: 'single';
        preview: PreviewOutcome;
        storeLinks: Array<{ storeId: string; displayName: string; mode: string; link: string | null }>;
      }
    | { kind: 'ambiguous'; carrierKeys: string[] }
    | { kind: 'none' }
  > {
    const carriers = await this.prisma.carrier.findMany({
      where: { enabled: true },
    });
    const ruleSets = carriers.map(toRuleSet);
    // Tracking-jump model: the same number resolves to a different link per
    // store; the preview lists every store so each configuration can be
    // verified without entering a shipment.
    const [{ ownSiteTrackingUrlTemplate }, stores] = await Promise.all([
      this.settings.resolved(),
      this.prisma.store.findMany({
        select: { id: true, displayName: true, settings: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    const withStoreLinks = (outcome: PreviewOutcome) => ({
      kind: 'single' as const,
      preview: outcome,
      storeLinks: stores.map((store) => {
        const jump = readTrackingJump(store.settings);
        return {
          storeId: store.id,
          displayName: store.displayName,
          mode: jump.mode,
          link: displayTrackingUrl(jump, ownSiteTrackingUrlTemplate, {
            attakyTrackingNumber: outcome.attakyTrackingNumber,
            originalTrackingNumber: outcome.normalizedNumber,
            attakyTrackingUrl: outcome.attakyTrackingUrl,
            carrierTrackingUrl: outcome.carrierTrackingUrl,
          }),
        };
      }),
    });
    if (carrierId) {
      const carrier = ruleSets.find((c) => c.key === carrierId);
      if (!carrier) throw new NotFoundException('Carrier not found.');
      return withStoreLinks(previewForCarrier(trackingNumber, carrier));
    }
    const match = matchCarriers(trackingNumber, ruleSets);
    if (match.kind === 'none') return { kind: 'none' };
    if (match.kind === 'ambiguous') {
      return { kind: 'ambiguous', carrierKeys: match.carriers.map((c) => c.key) };
    }
    return withStoreLinks(previewForCarrier(trackingNumber, match.carrier));
  }

  /** §12.4 collision detection over operator-provided sample numbers. */
  async collisions(
    id: string,
    samples: string[],
  ): Promise<Array<{ a: string; b: string; attakyNumber: string }>> {
    const carrier = await this.prisma.carrier.findUnique({ where: { id } });
    if (!carrier) throw new NotFoundException('Carrier not found.');
    return findTransformCollisions(samples, toRuleSet(carrier));
  }

  private validateRules(dto: CarrierInputDto): void {
    try {
      validateRecognition(dto.recognition as never);
      if (dto.attakyTransform) validateAttakyTransform(dto.attakyTransform as never);
    } catch (error) {
      if (error instanceof InvalidRuleError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
