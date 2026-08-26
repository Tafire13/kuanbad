"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ThemeToggle from "@/components/ThemeToggle";

interface GroupRow {
  code: string;
  name: string;
  createdAt: number;
}

export default function Home() {
  const router = useRouter();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/groups");
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) {
          setGroups(data.groups ?? []);
          setLoaded(true);
        }
      } catch {
        /* ignore */
      }
    };
    void tick();
    const id = setInterval(() => void tick(), 4000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const create = async () => {
    const n = name.trim();
    if (!n) {
      setErr("ใส่ชื่อก๊วนก่อน");
      return;
    }
    setCreating(true);
    setErr("");
    try {
      const res = await fetch("/api/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n }),
      });
      if (!res.ok) {
        setErr("สร้างก๊วนไม่สำเร็จ ลองใหม่อีกครั้ง");
        return;
      }
      const data = await res.json();
      router.push(`/g/${data.code}`);
    } catch {
      setErr("สร้างก๊วนไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setCreating(false);
    }
  };

  const copyLink = async (code: string) => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/g/${code}`);
      setCopied(code);
      setTimeout(() => {
        setCopied(null);
      }, 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <main className="min-h-screen">
      <ThemeToggle />
      <div className="mx-auto w-full max-w-6xl px-4 py-8">
        <header className="mb-8">
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-900 via-emerald-600 to-teal-500 px-6 py-9 text-center shadow-xl shadow-emerald-900/20 ring-1 ring-emerald-900/10">
            <div className="pointer-events-none absolute -top-16 -left-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
            <div className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-lime-300/20 blur-3xl" />
            <h1 className="relative text-3xl font-bold tracking-wide text-white drop-shadow-md sm:text-4xl">
              ก๊วนตีแบดมินตัน
            </h1>
            <p className="relative mt-2 text-sm text-emerald-100/90">
              สร้างลิงก์ก๊วน แชร์ให้เพื่อนกดเข้ามา จับคู่ เช็คชื่อ จัดตาราง — ตรงนี้คือหน้าแรก
            </p>
            <div className="relative mt-3 flex justify-center gap-2">
              <Link
                href="/tournament"
                className="rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-white/25"
              >
                โหมด Tournament
              </Link>
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-6 lg:flex-row">
          <aside className="lg:w-96 lg:shrink-0">
            <div className="space-y-4 lg:sticky lg:top-6">
              <section className="rounded-2xl bg-white p-5 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
                <div className="mb-3 flex items-center gap-2">
                  <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-emerald-500 to-teal-400" />
                  <h2 className="font-semibold text-slate-700 dark:text-slate-200">
                    สร้างก๊วนใหม่
                  </h2>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">
                      ชื่อก๊วน
                    </label>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && create()}
                      maxLength={40}
                      placeholder="เช่น ก๊วน CS KhemKhang"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                    />
                  </div>
                  {err && (
                    <p className="text-xs font-medium text-rose-600">{err}</p>
                  )}
                  <button
                    onClick={create}
                    disabled={creating}
                    className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {creating ? "กำลังสร้าง..." : "สร้างลิงก์ก๊วน"}
                  </button>
                  <p className="text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
                    สร้างเสร็จได้ลิงก์ลับแบบ /g/XXXXXXXX (รหัส 8 ตัวอักษร สุ่มเดาไม่ได้)
                    — ส่งให้เพื่อนกดเข้าเพจจับคู่ของก๊วนนี้เท่านั้น
                  </p>
                </div>
              </section>
            </div>
          </aside>

          <section className="flex-1 space-y-4">
            <div className="flex items-center justify-between rounded-2xl bg-white p-4 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
              <span className="text-sm font-medium text-slate-600 dark:text-slate-300">
                ก๊วนที่โพสต์ไว้
              </span>
              <span className="text-xs text-slate-400 dark:text-slate-500">
                {groups.length} ก๊วน
              </span>
            </div>
            {loaded ? (
              groups.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 p-8 text-center dark:border-slate-700 dark:bg-slate-800/50">
                  <p className="text-sm font-medium text-slate-400 dark:text-slate-500">
                    ยังไม่มีก๊วน — สร้างก๊วนแรกด้านซ้ายเลย
                  </p>
                </div>
              ) : (
                groups.map((g) => (
                  <div
                    key={g.code}
                    className="flex items-center gap-3 p-4 rounded-xl border border-slate-200 bg-white transition-colors hover:border-emerald-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-emerald-700"
                  >
                    <Link
                      href={`/g/${g.code}`}
                      className="min-w-0 flex-1"
                    >
                      <span className="block truncate font-medium text-slate-700 dark:text-slate-200">
                        {g.name}
                      </span>
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        link: /g/{g.code}
                      </span>
                    </Link>
                    <button
                      onClick={() => copyLink(g.code)}
                      className="shrink-0 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-300 dark:hover:bg-emerald-900"
                    >
                      {copied === g.code ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}
                    </button>
                    <Link
                      href={`/g/${g.code}`}
                      className="shrink-0 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                    >
                      เปิด
                    </Link>
                  </div>
                ))
              )
            ) : (
              <p className="text-sm text-emerald-400/60">กำลังดึงข้อมูล...</p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
