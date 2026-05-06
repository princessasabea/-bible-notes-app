import { BookAudioLibrary } from "@/components/book-audio-library";

export default async function AudioBookPage({
  params,
  searchParams
}: {
  params: Promise<{ book: string }>;
  searchParams: Promise<{ translation?: string }>;
}): Promise<React.ReactElement> {
  const resolvedParams = await params;
  const resolvedSearch = await searchParams;

  return (
    <BookAudioLibrary
      initialBook={resolvedParams.book}
      requestedTranslation={resolvedSearch.translation ?? "amp"}
    />
  );
}
