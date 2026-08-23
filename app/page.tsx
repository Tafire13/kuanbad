"use client";

import CourtBoard from "@/components/CourtBoard";
import ThemeToggle from "@/components/ThemeToggle";

export default function Page() {
  return (
    <main className="min-h-screen">
      <ThemeToggle />
      <CourtBoard />
    </main>
  );
}
