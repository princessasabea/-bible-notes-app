import { PlaylistDetail } from "@/components/playlist-detail";

export default async function PlaylistDetailPage({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  return <PlaylistDetail id={id} />;
}
