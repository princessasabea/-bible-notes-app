export type ParagraphBlock = { type: "paragraph"; text: string };
export type HeadingBlock = { type: "heading"; text: string };
export type VerseBlock = {
  type: "verse";
  ref: string;
  canonicalRef: string;
  canonicalizationVersion: number;
  translation: string;
  resolvedText: string | null;
  resolvedAt: string | null;
};

export type NoteBlock = ParagraphBlock | HeadingBlock | VerseBlock;

export type NoteContent = {
  contentVersion: number;
  blocks: NoteBlock[];
};

export type Note = {
  id: string;
  title: string;
  content: NoteContent;
  content_version: number;
  created_at: string;
  updated_at: string;
};
