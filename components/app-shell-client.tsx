"use client";

import { MiniPlayer } from "@/components/mini-player";
import { QueueProvider } from "@/components/queue-context";
import { usePathname } from "next/navigation";

export function AppShellClient({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const isAudioExperience = pathname.startsWith("/audio");

  return (
    <QueueProvider>
      {children}
      {isAudioExperience ? null : <MiniPlayer />}
    </QueueProvider>
  );
}
