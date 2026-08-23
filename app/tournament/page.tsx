"use client";

import ThemeToggle from "@/components/ThemeToggle";
import TournamentBoard from "@/components/TournamentBoard";

export default function TournamentPage() {
  return (
    <main className="min-h-screen">
      <ThemeToggle />
      <TournamentBoard />
    </main>
  );
}
