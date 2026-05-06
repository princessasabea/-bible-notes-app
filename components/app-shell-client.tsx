"use client";

import { BibleAudioProvider } from "@/components/bible-audio-store";
import { MiniPlayer } from "@/components/mini-player";
import { QueueProvider } from "@/components/queue-context";
import { usePathname } from "next/navigation";

export function AppShellClient({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const isAudioExperience = pathname.startsWith("/audio");

  if (isAudioExperience) {
    return <BibleAudioProvider>{children}</BibleAudioProvider>;
  }

  return (
    <QueueProvider>
      {children}
      <MiniPlayer />
    </QueueProvider>
  );
}
