export interface NoteRevision {
  id: string;
  noteId: string;
  previousBody: string;
  editedBy: string;
  editedAt: string;
}

export interface NoteAuthor {
  id: string;
  name: string;
}

export interface Note {
  id: string;
  ownerType: string;
  ownerId: string;
  body: string;
  createdBy: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  revisions?: NoteRevision[];
  /** Author display data (id + name only; emails are never exposed). */
  createdByUser?: NoteAuthor | null;
  updatedByUser?: NoteAuthor | null;
}
