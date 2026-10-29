import { describe, expect, it } from 'vitest';
import {
  orderLineImages,
  platformImages,
  orderDetailLineImages,
} from './order-line-images';

describe('order image snapshots', () => {
  const historical = 'https://example.com/history.jpg',
    current = 'https://example.com/current.jpg';
  it('uses all images from the matching variant in the historical version', () => {
    const line = {
      itemVariant: { itemCode: 'A', images: [current] },
      itemContentVersion: {
        snapshot: {
          images: ['https://example.com/product.jpg'],
          variants: [
            { itemCode: 'B', images: [current] },
            {
              itemCode: 'A',
              images: [historical, 'https://example.com/second.jpg'],
            },
          ],
        },
      },
    };
    expect(orderLineImages(line)).toMatchObject({
      variantImages: [historical, 'https://example.com/second.jpg'],
      variantImageSource: 'snapshot',
    });
  });
  it('never replaces an empty or missing historical variant image with a product cover or current image', () => {
    for (const variants of [
      [{ itemCode: 'A', images: [] }],
      [],
      [{ itemCode: 'B', images: [historical] }],
    ]) {
      expect(
        orderLineImages({
          itemVariant: { itemCode: 'A', images: [current] },
          itemContentVersion: { snapshot: { images: [historical], variants } },
        }).variantImages,
      ).toEqual([]);
    }
  });
  it('labels current images when legacy lines have no snapshot', () => {
    expect(
      orderLineImages({ itemVariant: { images: [current] } }),
    ).toMatchObject({
      variantImages: [current],
      variantImageSource: 'current',
    });
    expect(orderLineImages({})).toMatchObject({ variantImages: [] });
  });
  it('keeps platform variant images separate from platform product images and rejects unsafe links', () => {
    expect(
      platformImages(
        {
          images: ['javascript:alert(1)', current],
          variants: [{ externalVariantId: 'v', images: [historical] }],
        },
        'v',
      ),
    ).toEqual({
      platformProductImages: [current],
      platformVariantImages: [historical],
    });
    expect(
      platformImages({ images: [current] }, 'missing').platformVariantImages,
    ).toEqual([]);
  });
});

it('offers explicitly separate current references for an old order with an empty image snapshot', () => {
  const result = orderDetailLineImages({
    itemVariant: {
      itemCode: 'A',
      images: ['https://example.com/current-variant.jpg'],
      item: { images: ['https://example.com/current-product.jpg'] },
    },
    itemContentVersion: {
      snapshot: { variants: [{ itemCode: 'A', images: [] }] },
    },
    listingVariant: {
      externalVariantId: 'v',
      listing: {
        currentVersion: {
          snapshot: { images: ['https://example.com/current-platform.jpg'] },
        },
      },
    },
  });
  expect(result.variantImages).toEqual([]);
  expect(result.variantImageSource).toBe('snapshot');
  expect(result.currentVariantImages).toEqual([
    'https://example.com/current-variant.jpg',
  ]);
  expect(result.currentProductImages).toEqual([
    'https://example.com/current-product.jpg',
  ]);
  expect(result.platformProductImages).toEqual([]);
  expect(result.currentPlatformProductImages).toEqual([
    'https://example.com/current-platform.jpg',
  ]);
});

it('does not replace existing historical product or variant photos with current references', () => {
  const result = orderDetailLineImages({
    itemVariant: {
      itemCode: 'A',
      images: ['https://example.com/current.jpg'],
      item: { images: ['https://example.com/current.jpg'] },
    },
    itemContentVersion: {
      snapshot: {
        images: ['https://example.com/product-history.jpg'],
        variants: [
          {
            itemCode: 'A',
            images: ['https://example.com/variant-history.jpg'],
          },
        ],
      },
    },
  });
  expect(result.productImages).toEqual([
    'https://example.com/product-history.jpg',
  ]);
  expect(result.variantImages).toEqual([
    'https://example.com/variant-history.jpg',
  ]);
  expect(result.currentVariantImages).toEqual([]);
  expect(result.currentProductImages).toEqual([]);
});
