import { ChapterAudioPlayer } from "@/components/chapter-audio-player";
import { loadChapterAudioManifest } from "@/lib/audio/chapter-audio";

export default async function AudioChapterPage({
  params,
  searchParams
}: {
  params: Promise<{ book: string; chapter: string }>;
  searchParams: Promise<{ translation?: string }>;
}): Promise<React.ReactElement> {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;
  const result = await loadChapterAudioManifest(
    resolvedParams.book,
    resolvedParams.chapter,
    resolvedSearch.translation
  );

  return (
    <ChapterAudioPlayer
      initialBook={resolvedParams.book}
      initialChapter={Number(resolvedParams.chapter)}
      manifest={result.manifest}
      missingFiles={result.missingFiles}
      attemptedPath={result.attemptedPath}
      requestedTranslation={result.translation}
    />
  );
}
