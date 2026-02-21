"use client";

import { MiniPlayer } from "@/components/mini-player";
import { QueueProvider } from "@/components/queue-context";

export function AppShellClient({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <QueueProvider>
      {children}
      <MiniPlayer />
    </QueueProvider>
  );
}
