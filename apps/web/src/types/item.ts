/** Local views of Item-domain API responses (server returns Prisma shapes). */

export interface ItemVariant {
  id: string;
  itemId: string;
  itemCode: string;
  name: string;
  optionValues: Record<string, unknown> | null;
  images: Record<string, unknown> | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

import type { Note } from "./note";

export type { Note, NoteRevision, NoteAuthor } from "./note";

export interface Item {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  tags: string[];
  images: Record<string, unknown> | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  variants?: ItemVariant[];
  notes?: Note[];
  _count?: { variants: number; notes: number };
}

export interface ItemListResponse {
  items: Item[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
