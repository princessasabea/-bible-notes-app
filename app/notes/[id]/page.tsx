import { NoteEditor } from "@/components/note-editor";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }): Promise<React.ReactElement> {
  const { id } = await params;
  return <NoteEditor id={id} />;
}
