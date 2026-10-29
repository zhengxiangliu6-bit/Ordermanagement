/** Local views of Order-domain API responses. */

import type { LineImageData } from "../routes/items/line-image-previews";

export interface OrderLineView extends LineImageData {
  id: string;
  title: string | null;
  description: string | null;
  quantity: number;
  personalization: Record<string, unknown> | null;
  itemVariantId: string | null;
  itemVariant?: { id: string; itemCode: string; name: string } | null;
  listingVariant?: { id: string; externalSku: string | null } | null;
  itemContentVersion?: { id: string; effectiveAt: string } | null;
  listingContentVersion?: { id: string; effectiveAt: string } | null;
  createdAt: string;
}

export interface OrderRevisionView {
  id: string;
  reason: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  userId: string;
  createdAt: string;
}

export interface OrderView {
  id: string;
  source: string;
  storeId: string | null;
  platform: string | null;
  externalOrderId: string | null;
  displayNumber: string;
  statusRaw: Record<string, unknown> | null;
  customerSnapshot: Record<string, unknown> | null;
  buyerNote: string | null;
  deliveryMethod: string | null;
  financial: Record<string, unknown> | null;
  cancelledAt: string | null;
  cancelledBy: string | null;
  cancelledReason: string | null;
  archivedAt: string | null;
  deletedAt: string | null;
  rawSource: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lines?: OrderLineView[];
  revisions?: OrderRevisionView[];
  notes?: import("./note").Note[];
  /** Latest reviewer note body (list only, M7 follow-up). */
  latestReviewNote?: string | null;
  _count?: { lines: number; notes: number };
  region?: string | null;
  shippingRegion?: { id: string; name: string } | null;
  shippingMethod?: { id: string; name: string } | null;
  stage?: string;
  paymentStatus?: string | null;
  stageEvents?: Array<{
    id: string;
    fromStage: string | null;
    toStage: string;
    action: string;
    actorId: string;
    actorName?: string | null;
    note: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
  problemItems?: Array<{
    id: string;
    stageAtReport: string;
    type: string;
    content: string;
    status: string;
    reportedBy: string;
    reportedByName?: string | null;
    reportedAt: string;
    handledBy: string | null;
    handledByName?: string | null;
    handledAt: string | null;
    resolutionNote: string | null;
    copiedOrderId: string | null;
  }>;
  category?: { id: string; name: string } | null;
  shipments?: Array<{
    attakyTrackingNumber: string | null;
    originalTrackingNumber: string | null;
    tailTrackingNumber?: string | null;
    carrier: { name: string } | null;
    dispatchedAt: string | null;
  }>;
  store?: { displayName: string; platform: string } | null;
}

export interface OrderListResponse {
  orders: OrderView[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export interface CustomerInput {
  name?: string;
  phone?: string;
  email?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface ManualLink {
  linkId: string;
  orderId: string;
  displayNumber: string;
  customerSnapshot: Record<string, unknown> | null;
}

export interface SuggestedOrder {
  orderId: string;
  displayNumber: string;
  createdAt: string;
  customerSnapshot: Record<string, unknown> | null;
}

export interface RelatedResponse {
  manual: ManualLink[];
  suggestions: { strong: SuggestedOrder[]; weak: SuggestedOrder[] };
}

export interface AttachmentView {
  id: string;
  ownerType: string;
  ownerId: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
}
