"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import CourtBoard from "@/components/CourtBoard";
import ThemeToggle from "@/components/ThemeToggle";

export default function GroupPage() {
  const { code } = useParams<{ code: string }>();
  const [name, setName] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetch(`/api/groups/${code}`)
      .then((res) => {
        if (!res.ok) throw new Error("not_found");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setName(data.name);
      })
      .catch(() => {
        if (!cancelled) setNotFound(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (notFound) {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-3">
        <ThemeToggle />
        <h1 className="text-lg font-bold text-slate-700 dark:text-slate-200">
          ไม่พบก๊วนนี้
        </h1>
        <p className="text-sm text-slate-400">
          รหัสก๊วนไม่ถูกต้อง หรือก๊วนนี้ยังไม่ได้สร้าง
        </p>
        <Link
          href="/"
          className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-emerald-700"
        >
          กลับหน้าแรก
        </Link>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <ThemeToggle />
      {name ? (
        <CourtBoard
          storageKey={`kuanbad-group-${code}`}
          title={name}
          subtitle={`ก๊วนนี้ไม่ sync เซิร์ฟเวอร์ — ข้อมูลอยู่เครื่องที่เปิดหน้านี้เท่านั้น`}
        />
      ) : (
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-sm text-slate-400">กำลังโหลด...</p>
        </div>
      )}
      <footer className="pb-6 text-center text-xs text-slate-400 dark:text-slate-500">
        <Link href="/" className="underline-offset-2 hover:underline">
          ⌂ หน้าแรก
        </Link>
      </footer>
    </main>
  );
}
