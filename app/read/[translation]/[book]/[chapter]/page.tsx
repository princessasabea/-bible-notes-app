import { ReaderMode } from "@/components/reader-mode";

export default async function ReadPage({
  params
}: {
  params: Promise<{ translation: string; book: string; chapter: string }>;
}): Promise<React.ReactElement> {
  const resolved = await params;

  return (
    <ReaderMode
      initialTranslation={resolved.translation}
      initialBook={resolved.book}
      initialChapter={Number(resolved.chapter)}
    />
  );
}
