import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { auth } from "@/auth";
import { AppShellClient } from "@/components/app-shell-client";
import { SignInOutButton } from "@/components/sign-in-out-button";

export const metadata: Metadata = {
  title: "Fellowship",
  description: "A scripture-focused journal with verse references and study notes"
};

export default async function RootLayout({ children }: { children: React.ReactNode }): Promise<React.ReactElement> {
  const session = await auth();

  return (
    <html lang="en">
      <body>
        <main className="app-shell">
          <header className="app-header panel">
            <div>
              <p className="eyebrow">Bible Journal</p>
              <h1>Fellowship</h1>
            </div>
            <div className="header-right">
              <nav className="primary-nav" aria-label="Primary">
                <Link href="/" className="nav-link">Scripture</Link>
                <Link href="/notes" className="nav-link">Journal</Link>
              </nav>
              <SignInOutButton email={session?.user?.email ?? null} />
            </div>
          </header>
          <AppShellClient>{children}</AppShellClient>
        </main>
      </body>
    </html>
  );
}
