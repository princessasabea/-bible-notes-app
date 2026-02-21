import { z } from "zod";
import { sanitizeText } from "@/lib/security";

export const paragraphBlockSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string().transform(sanitizeText)
});

export const headingBlockSchema = z.object({
  type: z.literal("heading"),
  text: z.string().transform(sanitizeText)
});

export const verseBlockSchema = z.object({
  type: z.literal("verse"),
  ref: z.string().transform(sanitizeText),
  canonicalRef: z.string().transform(sanitizeText),
  canonicalizationVersion: z.number().int().default(1),
  translation: z.string().transform(sanitizeText),
  resolvedText: z.string().nullable().default(null),
  resolvedAt: z.string().datetime().nullable().default(null)
});

export const noteBlockSchema = z.union([
  paragraphBlockSchema,
  headingBlockSchema,
  verseBlockSchema
]);

export const noteContentSchema = z.object({
  contentVersion: z.number().int().default(1),
  blocks: z.array(noteBlockSchema)
});

export const noteMutationSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().max(120).transform(sanitizeText).default(""),
  contentVersion: z.number().int().default(1),
  content: noteContentSchema
});

export type NoteContent = z.infer<typeof noteContentSchema>;
