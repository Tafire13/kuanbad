"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_MEMBERS = [
  "เอ",
  "โฟน",
  "มินตรา",
  "มิ้น",
  "แม็ค",
  "กัน",
  "ฟิล์ม",
  "แฟ้ม",
  "จาเมส",
  "วาวา",
  "เฟรม",
  "คิว",
  "หยก",
  "โชค",
  "ป่อง",
];

const MAX_COURTS = 10;

type CourtStatus = "idle" | "ready" | "playing" | "done";

interface CourtState {
  teamA: string[];
  teamB: string[];
  status: CourtStatus;
  startAt: number | null;
  lastElapsed: number | null;
}

const emptyCourt = (): CourtState => ({
  teamA: [],
  teamB: [],
  status: "idle",
  startAt: null,
  lastElapsed: null,
});

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const fmtClock = (s: number) =>
  `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

const fmtTotal = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m} นาที ${sec} วินาที` : `${sec} วินาที`;
};

const STATUS_LABEL: Record<CourtStatus, string> = {
  idle: "ยังไม่จับคู่",
  ready: "พร้อมเล่น",
  playing: "กำลังเล่น",
  done: "เล่นจบแล้ว",
};

export default function Page() {
  const [members, setMembers] = useState<string[]>(() => {
    if (typeof window === "undefined") return DEFAULT_MEMBERS;
    try {
      const saved = JSON.parse(localStorage.getItem("kuanbad-members") ?? "");
      if (Array.isArray(saved) && saved.length > 0) return saved;
    } catch {
      /* ignore */
    }
    return DEFAULT_MEMBERS;
  });
  const [courts, setCourts] = useState<CourtState[]>(() =>
    Array.from({ length: 2 }, emptyCourt)
  );
  const [now, setNow] = useState(() => Date.now());
  const [totals, setTotals] = useState<Record<string, number>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(localStorage.getItem("kuanbad-totals") ?? "{}");
    } catch {
      return {};
    }
  });
  const [newName, setNewName] = useState("");
  const [shuffling, setShuffling] = useState<number | null>(null);
  const [rollNames, setRollNames] = useState<string[]>([]);
  const [rollTick, setRollTick] = useState(0);
  const rollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (rollTimerRef.current) clearInterval(rollTimerRef.current);
    },
    []
  );

  useEffect(() => {
    localStorage.setItem("kuanbad-members", JSON.stringify(members));
  }, [members]);

  useEffect(() => {
    localStorage.setItem("kuanbad-totals", JSON.stringify(totals));
  }, [totals]);

  const anyPlaying = courts.some((c) => c.status === "playing");
  useEffect(() => {
    if (!anyPlaying) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyPlaying]);

  const lockedPlayers = (exceptIdx: number): Set<string> => {
    const s = new Set<string>();
    courts.forEach((c, i) => {
      if (i === exceptIdx) return;
      if (
        c.status === "ready" ||
        c.status === "playing" ||
        shuffling === i
      ) {
        [...c.teamA, ...c.teamB].forEach((n) => s.add(n));
      }
    });
    return s;
  };

  const poolFor = (idx: number) =>
    members.filter((n) => !lockedPlayers(idx).has(n));

  const inCourt = useMemo(() => {
    const s = new Set<string>();
    courts.forEach((c) => {
      if (c.status !== "idle") {
        [...c.teamA, ...c.teamB].forEach((n) => s.add(n));
      }
    });
    return s;
  }, [courts]);

  const freePlayers = members.filter((n) => !inCourt.has(n));
  const playingPlayers = useMemo(
    () =>
      new Set(
        courts
          .filter((c) => c.status === "playing")
          .flatMap((c) => [...c.teamA, ...c.teamB])
      ),
    [courts]
  );

  const addCourt = () =>
    setCourts((prev) =>
      prev.length < MAX_COURTS ? [...prev, emptyCourt()] : prev
    );

  const removeCourt = () =>
    setCourts((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));

  const addMember = () => {
    const name = newName.trim();
    if (!name) return;
    if (members.includes(name)) {
      alert("ชื่อนี้มีอยู่แล้ว");
      return;
    }
    setMembers((prev) => [...prev, name]);
    setNewName("");
  };

  const resetTimes = () => {
    if (!window.confirm("รีเซ็ตเวลาเล่นรวมทั้งหมด?")) return;
    setTotals({});
  };

  const pickCourtPair = (idx: number): string[] | null => {
    const pool = poolFor(idx);
    const current = new Set([...courts[idx].teamA, ...courts[idx].teamB]);
    if (pool.length < 4) return null;
    let picked: string[] | null = null;
    for (let t = 0; t < 100; t++) {
      const cand = shuffle(pool).slice(0, 4);
      const candSet = new Set(cand);
      const same =
        cand.length === current.size &&
        [...current].every((n) => candSet.has(n));
      if (!same || t === 99) {
        picked = cand;
        break;
      }
    }
    return picked;
  };

  const shuffleCourt = (idx: number) => {
    const picked = pickCourtPair(idx);
    if (!picked) return;
    const pool = poolFor(idx);
    setShuffling(idx);
    setRollNames(picked);
    setRollTick((t) => t + 1);
    const start = Date.now();
    if (rollTimerRef.current) clearInterval(rollTimerRef.current);
    rollTimerRef.current = setInterval(() => {
      const cand = shuffle(pool).slice(0, 4);
      setRollNames(cand);
      setRollTick((t) => t + 1);
      if (Date.now() - start > 1600) {
        if (rollTimerRef.current) clearInterval(rollTimerRef.current);
        rollTimerRef.current = null;
        setShuffling(null);
        setCourts((prev) => {
          const next = [...prev];
          next[idx] = {
            teamA: [picked[0], picked[1]],
            teamB: [picked[2], picked[3]],
            status: "ready",
            startAt: null,
            lastElapsed: null,
          };
          return next;
        });
      }
    }, 90);
  };

  const startCourt = (idx: number) =>
    setCourts((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        status: "playing",
        startAt: Date.now(),
      };
      return next;
    });

  const endCourt = (idx: number) => {
    const c = courts[idx];
    if (!c.startAt) return;
    const elapsed = Math.max(
      0,
      Math.floor((Date.now() - c.startAt) / 1000)
    );
    setTotals((prev) => {
      const next = { ...prev };
      [...c.teamA, ...c.teamB].forEach(
        (n) => (next[n] = (next[n] ?? 0) + elapsed)
      );
      return next;
    });
    setCourts((prev) => {
      const next = [...prev];
      next[idx] = {
        ...next[idx],
        status: "done",
        startAt: null,
        lastElapsed: elapsed,
      };
      return next;
    });
  };

  const elapsedOf = (c: CourtState) =>
    c.startAt ? Math.max(0, Math.floor((now - c.startAt) / 1000)) : 0;

  const statusColor: Record<CourtStatus, string> = {
    idle: "bg-slate-100 text-slate-500",
    ready: "bg-emerald-100 text-emerald-700",
    playing: "bg-lime-100 text-lime-700 animate-pulse",
    done: "bg-sky-100 text-sky-700",
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 flex-1">
      <header className="mb-8">
        <div className="rounded-3xl bg-gradient-to-r from-emerald-800 via-emerald-600 to-teal-500 px-6 py-8 text-center shadow-lg">
          <h1 className="text-3xl sm:text-4xl font-bold text-white drop-shadow-sm">
            ก๊วน CS KhemKhang
          </h1>
          <p className="mt-2 text-emerald-100">
            จับคู่ตีแบดมินตันและจับเวลา — {courts.length} คอร์ด
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-80 lg:shrink-0">
          <div className="space-y-4 lg:sticky lg:top-6">
            <section className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
              <h2 className="mb-3 font-semibold text-slate-700">
                คนที่อยู่ในคอร์ด
              </h2>
              {courts.filter((c) => c.status !== "idle").length === 0 ? (
                <p className="text-sm text-slate-400">
                  ยังไม่มีคู่ — กดสุ่มคู่ที่คอร์ด
                </p>
              ) : (
                courts.map(
                  (court, idx) =>
                    court.status !== "idle" && (
                      <div key={idx} className="mb-3 last:mb-0">
                        <div className="mb-1 flex items-center justify-between text-xs font-semibold text-slate-500">
                          <span>คอร์ด {idx + 1}</span>
                          <span className="tabular-nums">
                            {court.status === "playing"
                              ? `เล่นอยู่ ${fmtClock(elapsedOf(court))}`
                              : court.status === "done"
                                ? `จบแล้ว ${fmtTotal(court.lastElapsed ?? 0)}`
                                : "พร้อมเล่น"}
                          </span>
                        </div>
                        <div className="rounded-lg border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 px-2 py-2">
                          <div className="flex items-center justify-between gap-1 text-sm font-semibold text-emerald-800">
                            <span className="flex-1 rounded-md bg-white px-2 py-1 text-center shadow-sm">
                              {court.teamA[0]}
                            </span>
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 text-[9px] font-extrabold text-white">
                              VS
                            </span>
                            <span className="flex-1 rounded-md bg-white px-2 py-1 text-center shadow-sm">
                              {court.teamA[1]}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-1 text-sm font-medium text-emerald-700">
                            <span className="flex-1 rounded-md bg-white px-2 py-1 text-center shadow-sm">
                              {court.teamB[0]}
                            </span>
                            <span className="w-5 shrink-0" />
                            <span className="flex-1 rounded-md bg-white px-2 py-1 text-center shadow-sm">
                              {court.teamB[1]}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                )
              )}
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-700">
                  คนที่ว่าง ({freePlayers.length})
                </h2>
              </div>
              {freePlayers.length === 0 ? (
                <p className="text-sm text-slate-400">ทุกคนลงคอร์ดแล้ว</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {freePlayers.map((name) => (
                    <span
                      key={name}
                      className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-slate-700">เวลาเล่นรวม</h2>
                <button
                  onClick={resetTimes}
                  className="rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-600 hover:bg-rose-100"
                >
                  รีเซ็ตเวลา
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {members.map((name) => {
                  const active = playingPlayers.has(name);
                  return (
                    <li
                      key={name}
                      className="flex items-center justify-between py-1.5"
                    >
                      <span
                        className={`font-medium ${
                          active ? "text-emerald-700" : "text-slate-700"
                        }`}
                      >
                        {name}
                        {active && (
                          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                            เล่นอยู่
                          </span>
                        )}
                      </span>
                      <span className="text-sm text-slate-500 tabular-nums">
                        {fmtTotal(totals[name] ?? 0)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="rounded-2xl bg-white p-5 shadow-sm border border-slate-200">
              <h2 className="mb-2 font-semibold text-slate-700">เพิ่มชื่อ</h2>
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addMember()}
                  placeholder="ชื่อสมาชิก"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none"
                />
                <button
                  onClick={addMember}
                  className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
                >
                  เพิ่ม
                </button>
              </div>
            </section>
          </div>
        </aside>

        <section className="flex-1 space-y-4">
          <div className="flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm border border-slate-200">
            <h2 className="font-semibold text-slate-700">
              คอร์ด ({courts.length})
            </h2>
            <div className="flex gap-2">
              <button
                onClick={removeCourt}
                disabled={courts.length <= 1}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ลดคอร์ด
              </button>
              <button
                onClick={addCourt}
                disabled={courts.length >= MAX_COURTS}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                เพิ่มคอร์ด
              </button>
            </div>
          </div>

          {courts.map((court, idx) => {
            const poolCount = poolFor(idx).length;
            const canShuffle = poolCount >= 4;
            return (
              <div
                key={idx}
                className="rounded-2xl bg-white p-6 shadow-sm border border-slate-200"
              >
                <div className="mb-4 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-slate-700">
                    คอร์ด {idx + 1}
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${statusColor[court.status]}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full bg-current ${
                        shuffling === idx ? "animate-ping" : ""
                      }`}
                    />
                    {shuffling === idx
                      ? "กำลังสุ่ม..."
                      : STATUS_LABEL[court.status]}
                  </span>
                </div>

                {shuffling === idx ? (
                  <div className="py-2">
                    <p className="mb-3 text-center text-sm font-semibold text-emerald-600">
                      กำลังสุ่มคู่...
                    </p>
                    <div className="flex items-stretch gap-3">
                      <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3">
                        <span
                          key={`a0-${rollTick}`}
                          className="animate-slot-in rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-emerald-800 shadow-sm"
                        >
                          {rollNames[0]}
                        </span>
                        <span
                          key={`a1-${rollTick}`}
                          className="animate-slot-in rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-emerald-800 shadow-sm"
                        >
                          {rollNames[1]}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <span className="flex h-10 w-10 animate-pulse items-center justify-center rounded-full bg-rose-500 text-sm font-extrabold text-white shadow-md">
                          VS
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50/60 p-3">
                        <span
                          key={`b0-${rollTick}`}
                          className="animate-slot-in rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-sky-800 shadow-sm"
                        >
                          {rollNames[2]}
                        </span>
                        <span
                          key={`b1-${rollTick}`}
                          className="animate-slot-in rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-sky-800 shadow-sm"
                        >
                          {rollNames[3]}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : court.status === "idle" ? (
                  <div className="flex flex-col items-center gap-3 py-4">
                    <p className="text-sm text-slate-400">
                      ยังไม่มีคู่ — ผู้เล่นว่าง {poolCount} คน
                    </p>
                    <button
                      onClick={() => shuffleCourt(idx)}
                      disabled={!canShuffle}
                      className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      สุ่มคู่
                    </button>
                    {!canShuffle && (
                      <p className="text-sm text-amber-600">
                        ผู้เล่นว่างไม่พอ (ต้อง 4 คนขึ้นไป)
                      </p>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex items-stretch gap-3">
                      <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-3">
                        <span className="rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-emerald-800 shadow-sm">
                          {court.teamA[0]}
                        </span>
                        <span className="rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-emerald-800 shadow-sm">
                          {court.teamA[1]}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500 text-sm font-extrabold text-white shadow-md">
                          VS
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-sky-100 p-3">
                        <span className="rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-sky-800 shadow-sm">
                          {court.teamB[0]}
                        </span>
                        <span className="rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-sky-800 shadow-sm">
                          {court.teamB[1]}
                        </span>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                      {court.status === "ready" && (
                        <>
                          <button
                            onClick={() => startCourt(idx)}
                            className="rounded-xl bg-lime-600 px-6 py-2.5 font-semibold text-white shadow-sm transition-colors hover:bg-lime-700"
                          >
                            เริ่มเกม
                          </button>
                          <button
                            onClick={() => shuffleCourt(idx)}
                            className="rounded-xl bg-slate-100 px-6 py-2.5 font-semibold text-slate-600 transition-colors hover:bg-slate-200"
                          >
                            สุ่มใหม่
                          </button>
                        </>
                      )}
                      {court.status === "playing" && (
                        <>
                          <span className="text-lg font-bold text-emerald-700 tabular-nums">
                            ⏱ {fmtClock(elapsedOf(court))}
                          </span>
                          <button
                            onClick={() => endCourt(idx)}
                            className="rounded-xl bg-rose-600 px-6 py-2.5 font-semibold text-white shadow-sm transition-colors hover:bg-rose-700"
                          >
                            จบเกม
                          </button>
                        </>
                      )}
                      {court.status === "done" && (
                        <button
                          onClick={() => shuffleCourt(idx)}
                          className="rounded-xl bg-emerald-600 px-6 py-2.5 font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
                        >
                          สุ่มคู่ใหม่
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </section>
      </div>

      <footer className="mt-8 text-center text-xs text-slate-400">
        ก๊วน CS KhemKhang
      </footer>
    </main>
  );
}