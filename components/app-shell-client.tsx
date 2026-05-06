"use client";

import { MiniPlayer } from "@/components/mini-player";
import { QueueProvider } from "@/components/queue-context";
import { usePathname } from "next/navigation";

export function AppShellClient({ children }: { children: React.ReactNode }): React.ReactElement {
  const pathname = usePathname();
  const isAudioExperience = pathname.startsWith("/audio");

  if (isAudioExperience) {
    return <>{children}</>;
  }

  return (
    <QueueProvider>
      {children}
      <MiniPlayer />
    </QueueProvider>
  );
}
