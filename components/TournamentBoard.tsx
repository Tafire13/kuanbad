"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const MAX_COURTS = 10;
const POLL_MS = 1500;
const STORAGE_KEY = "kuanbad-tournament";
const STATE_URL = "/api/tstate";
const DIFF_WEIGHTS = [4, 2.5, 1.2, 0.6, 0.3, 0.2];

interface TCourt {
  a: string[];
  b: string[];
  status: "idle" | "ready" | "playing";
  startAt: number | null;
}

interface TGameRow {
  ts: number;
  a: string[];
  b: string[];
  sa: number;
  sb: number;
}

interface TournamentState {
  members: string[];
  presence: Record<string, boolean>;
  scores: Record<string, number>;
  games: TGameRow[];
  courts: TCourt[];
  finishedAt: number | null;
}

const emptyCourt = (): TCourt => ({
  a: [],
  b: [],
  status: "idle",
  startAt: null,
});

const defaultState = (): TournamentState => ({
  members: [],
  presence: {},
  scores: {},
  games: [],
  courts: Array.from({ length: 2 }, emptyCourt),
  finishedAt: null,
});

const pairKey = (x: string, y: string) => [x, y].sort().join("::");

const isArrived = (st: TournamentState, n: string) =>
  st.presence?.[n] ?? true;

const playedOf = (st: TournamentState, n: string) =>
  st.games.filter((g) => g.a.includes(n) || g.b.includes(n)).length;

const usedPairsOf = (games: TGameRow[]) => {
  const s = new Set<string>();
  games.forEach((g) => {
    if (g.a.length === 2) s.add(pairKey(g.a[0], g.a[1]));
    if (g.b.length === 2) s.add(pairKey(g.b[0], g.b[1]));
  });
  return s;
};

const pairCount = (n: number) => (n * (n - 1)) / 2;

const nowMs = () => Date.now();
const rand01 = () => Math.random();

function normalizeState(st: TournamentState): TournamentState {
  return {
    ...st,
    members: st.members ?? [],
    presence: st.presence ?? {},
    scores: st.scores ?? {},
    games: st.games ?? [],
    courts: Array.isArray(st.courts) && st.courts.length >= 1
      ? st.courts
      : Array.from({ length: 2 }, emptyCourt),
    finishedAt: st.finishedAt ?? null,
  };
}

function loadLocal(): TournamentState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const st = JSON.parse(raw) as TournamentState;
    if (st && Array.isArray(st.members) && Array.isArray(st.courts)) {
      return normalizeState(st);
    }
  } catch {
    /* ignore */
  }
  return null;
}

function persistLocal(st: TournamentState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  } catch {
    /* ignore */
  }
}

export default function TournamentBoard() {
  const persisted = loadLocal();
  const [app, setApp] = useState<TournamentState>(
    normalizedInit(persisted)
  );
  const [, setOnline] = useState(false);
  const [newName, setNewName] = useState("");
  const [scores, setScores] = useState<Record<number, { a: string; b: string }>>(
    {}
  );
  const appRef = useRef(app);
  const revRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const bootedRef = useRef(false);
  const pushChainRef = useRef<Promise<void>>(Promise.resolve());

  function normalizedInit(p: TournamentState | null): TournamentState {
    return p ? normalizeState(p) : defaultState();
  }

  const setBoth = (st: TournamentState) => {
    appRef.current = st;
    setApp(st);
    persistLocal(st);
  };

  const commit = (updater: (prev: TournamentState) => TournamentState) => {
    const next = updater(appRef.current);
    setBoth(next);
    pushChainRef.current = pushChainRef.current.then(async () => {
      pendingRef.current = true;
      try {
        const res = await fetch(STATE_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: next, baseRev: revRef.current }),
        });
        if (res.ok) {
          const data = await res.json();
          revRef.current = data.rev;
          setOnline(true);
        } else if (res.status === 409) {
          const data = await res.json();
          if (data.state) {
            revRef.current = data.rev;
            setBoth(normalizeState(data.state));
          }
          setOnline(true);
        } else {
          setOnline(false);
        }
      } catch {
        setOnline(false);
      } finally {
        pendingRef.current = false;
      }
    });
  };

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(STATE_URL);
        if (!res.ok) {
          setOnline(false);
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        setOnline(true);
        if (!bootedRef.current) {
          bootedRef.current = true;
          if (data.state) {
            revRef.current = data.rev;
            setBoth(normalizeState(data.state));
          }
        } else if (
          !pendingRef.current &&
          data.state &&
          data.rev !== revRef.current
        ) {
          revRef.current = data.rev;
          setBoth(normalizeState(data.state));
        }
      } catch {
        setOnline(false);
      }
    };
    void tick();
    const id = setInterval(() => void tick(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const usedPairs = useMemo(() => usedPairsOf(app.games), [app.games]);
  const arrivedMembers = app.members.filter((n) => isArrived(app, n));
  const totalPairs = pairCount(arrivedMembers.length);
  const progress =
    totalPairs > 0 ? usedPairs.size / totalPairs : 0;
  const done =
    totalPairs > 0 && usedPairs.size >= totalPairs;

  const rosterTotal = app.members.length;
  const unlockedArrived = arrivedMembers.length;

  const inCourtNames = useMemo(() => {
    const s = new Set<string>();
    app.courts.forEach((c, i) => {
      if (i >= 0 && c.status !== "idle") {
        [...c.a, ...c.b].forEach((n) => s.add(n));
      }
    });
    return s;
  }, [app.courts]);

  const freePlayers = app.members.filter(
    (n) => isArrived(app, n) && !inCourtNames.has(n)
  );

  const standings = useMemo(
    () =>
      app.members
        .map((n) => ({
          name: n,
          pts: app.scores?.[n] ?? 0,
          games: playedOf(app, n),
          wins: app.games.filter((g) =>
            g.a.includes(n) ? g.sa > g.sb : g.b.includes(n) && g.sb > g.sa
          ).length,
        }))
        .sort((x, y) => y.pts - x.pts || y.games - x.games),
    [app]
  );

  const addMember = () => {
    const name = newName.trim();
    if (!name) return;
    if (appRef.current.members.includes(name)) {
      alert("ชื่อนี้มีอยู่แล้ว");
      return;
    }
    setNewName("");
    commit((prev) => ({
      ...prev,
      members: [...prev.members, name],
      presence: { ...(prev.presence ?? {}), [name]: false },
    }));
  };

  const togglePresence = (name: string) =>
    commit((prev) => ({
      ...prev,
      presence: { ...(prev.presence ?? {}), [name]: !isArrived(prev, name) },
    }));

  const checkAllPresence = () =>
    commit((prev) => {
      const presence = { ...(prev.presence ?? {}) };
      prev.members.forEach((n) => {
        presence[n] = true;
      });
      return { ...prev, presence };
    });

  const removeMember = (name: string) => {
    if (inCourtNames.has(name)) {
      alert("คนนี้อยู่ในคอร์ดอยู่ ลาก/เคลียร์คอร์ดก่อน");
      return;
    }
    if (!window.confirm(`ลบ "${name}" ออกจากสมาชิก?`)) return;
    commit((prev) => {
      const presence = { ...(prev.presence ?? {}) };
      const scores = { ...(prev.scores ?? {}) };
      delete presence[name];
      delete scores[name];
      return {
        ...prev,
        members: prev.members.filter((n) => n !== name),
        presence,
        scores,
      };
    });
  };

  const clearRoster = () => {
    if (inCourtNames.size > 0) {
      alert("มีคนอยู่ในคอร์ดอยู่ — เคลียร์คอร์ดก่อน");
      return;
    }
    if (!window.confirm("ลบรายชื่อทั้งหมด? (ลบสมาชิก แต้ม และประวัติเกม)")) return;
    commit((prev) => ({
      ...prev,
      members: [],
      presence: {},
      scores: {},
      games: [],
      finishedAt: null,
      courts: prev.courts.map(() => emptyCourt()),
    }));
  };

  const resetTournament = () => {
    if (!window.confirm("เริ่ม tournament ใหม่? (ล้างแต้ม เกม และคอร์ด)")) return;
    setScores({});
    commit((prev) => ({
      ...prev,
      scores: {},
      games: [],
      finishedAt: null,
      courts: prev.courts.map(() => emptyCourt()),
    }));
  };

  const addCourt = () =>
    commit((prev) =>
      prev.courts.length < MAX_COURTS
        ? { ...prev, courts: [...prev.courts, emptyCourt()] }
        : prev
    );

  const removeCourt = () =>
    commit((prev) =>
      prev.courts.length > 1
        ? { ...prev, courts: prev.courts.slice(0, -1) }
        : prev
    );

  const drawCourt = (idx: number) => {
    const st = appRef.current;
    const locked = new Set<string>();
    st.courts.forEach((c, i) => {
      if (i === idx) return;
      if (c.status !== "idle") [...c.a, ...c.b].forEach((n) => n && locked.add(n));
    });
    const pool = st.members.filter((n) => isArrived(st, n) && !locked.has(n));
    if (pool.length < 4) return;

    const now = nowMs();
    const lastPlay = (n: string) =>
      st.games.reduce(
        (m, g) => (g.a.includes(n) || g.b.includes(n) ? Math.max(m, g.ts) : m),
        0
      );
    const rested = pool.filter((n) => now - lastPlay(n) >= 60_000);
    const source = rested.length >= 4 ? rested : pool;

    const played = (n: string) => playedOf(st, n);
    const minP = Math.min(...source.map((n) => played(n)));
    const weightOf = (n: string) =>
      DIFF_WEIGHTS[Math.min(played(n) - minP, DIFF_WEIGHTS.length - 1)];

    const sample = (k: number): string[] => {
      const left = [...source];
      const out: string[] = [];
      while (out.length < k && left.length > 0) {
        let total = 0;
        for (const n of left) total += Math.max(weightOf(n), 0.001);
        if (total <= 0) break;
        let r = rand01() * total;
        let chosen = left[left.length - 1];
        for (const n of left) {
          r -= Math.max(weightOf(n), 0.001);
          if (r <= 0) {
            chosen = n;
            break;
          }
        }
        out.push(chosen);
        left.splice(left.indexOf(chosen), 1);
      }
      return out;
    };

    const us = usedPairsOf(st.games);
    const current = appRef.current.courts[idx];
    const curSet = new Set([...current.a, ...current.b].filter(Boolean));
    const same4 = (four: string[]) =>
      four.length === 4 &&
      curSet.size === 4 &&
      [...curSet].every((n) => four.includes(n));

    let best: { a: string[]; b: string[]; used: number } | null = null;
    for (let t = 0; t < 60; t++) {
      const four = sample(4);
      if (four.length < 4) break;
      const [p0, p1, p2, p3] = four;
      const opts: [string[], string[]][] = [
        [
          [p0, p1],
          [p2, p3],
        ],
        [
          [p0, p2],
          [p1, p3],
        ],
        [
          [p0, p3],
          [p1, p2],
        ],
      ];
      const flip = rand01() < 0.5;
      const options = flip ? ([...opts].reverse() as [string[], string[]][]) : opts;
      for (const o of options) {
        if (same4(four)) continue;
        const used =
          (us.has(pairKey(o[0][0], o[0][1])) ? 1 : 0) +
          (us.has(pairKey(o[1][0], o[1][1])) ? 1 : 0);
        if (!best || used < best.used) {
          best = { a: [...o[0]], b: [...o[1]], used };
          if (used === 0) break;
        }
      }
      if (best && best.used === 0) break;
    }
    if (!best) return;
    commit((prev) => {
      if (idx >= prev.courts.length) return prev;
      const courts = [...prev.courts];
      courts[idx] = {
        a: [...best.a],
        b: [...best.b],
        status: "ready",
        startAt: null,
      };
      return { ...prev, courts };
    });
  };

  const drawAllIdle = () => {
    app.courts.forEach((c, i) => {
      if (c.status === "idle") drawCourt(i);
    });
  };

  const startCourt = (idx: number) =>
    commit((prev) => {
      if (idx >= prev.courts.length) return prev;
      const courts = [...prev.courts];
      courts[idx] = { ...courts[idx], status: "playing", startAt: Date.now() };
      return { ...prev, courts };
    });

  const clearCourt = (idx: number) =>
    commit((prev) => {
      if (idx >= prev.courts.length) return prev;
      const courts = [...prev.courts];
      courts[idx] = emptyCourt();
      return { ...prev, courts };
    });

  const endGame = (idx: number) => {
    const st = appRef.current;
    const c = st.courts[idx];
    if (!c || c.a.length !== 2 || c.b.length !== 2) return;
    const raw = scores[idx];
    const sa = Number(raw?.a);
    const sb = Number(raw?.b);
    if (!Number.isInteger(sa) || !Number.isInteger(sb) || sa < 0 || sb < 0) {
      alert("กรอกสกอร์เป็นตัวเลข (จำนวนแต้มทั้งสองทีม)");
      return;
    }
    if (sa === sb) {
      alert("สกอร์เท่ากัน — กรอกผลลัพธ์จริง (ต้องมีฝ่ายชนะ)");
      return;
    }
    const diff = Math.abs(sa - sb);
    const winA = sa > sb;
    const wTeam = winA ? [...c.a] : [...c.b];
    const lTeam = winA ? [...c.b] : [...c.a];
    commit((prev) => {
      const games = [
        ...prev.games,
        { ts: Date.now(), a: [...c.a], b: [...c.b], sa, sb },
      ];
      const scores2 = { ...(prev.scores ?? {}) };
      wTeam.forEach((n) => {
        scores2[n] = (scores2[n] ?? 0) + diff;
      });
      lTeam.forEach((n) => {
        scores2[n] = (scores2[n] ?? 0) - diff;
      });
      const courts = [...prev.courts];
      courts[idx] = emptyCourt();
      const used = usedPairsOf(games);
      const arrivals = prev.members.filter((n) => isArrived(prev, n));
      const total = pairCount(arrivals.length);
      const finishedAt =
        prev.finishedAt ??
        (total > 0 && used.size >= total ? Date.now() : null);
      return { ...prev, games, scores: scores2, courts, finishedAt };
    });
    setScores((prev) => {
      const next = { ...prev };
      delete next[idx];
      return next;
    });
  };

  const scoreInput = (
    idx: number,
    team: "a" | "b",
    label: string,
    names: string[]
  ) => (
    <div className="flex-1">
      <div className="mb-1 text-center text-xs font-semibold text-slate-500 dark:text-slate-400">
        {label}
      </div>
      <input
        type="number"
        min={0}
        value={scores[idx]?.[team] ?? ""}
        onChange={(e) =>
          setScores((prev) => ({
            ...prev,
            [idx]: {
              ...(prev[idx] ?? { a: "", b: "" }),
              [team]: e.target.value,
            },
          }))
        }
        placeholder="21"
        className="w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-center text-lg font-bold text-slate-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
      <div className="mt-1 text-center text-[10px] text-slate-400 dark:text-slate-500">
        {names.join(" × ")}
      </div>
    </div>
  );

  const statusPill: Record<TCourt["status"], string> = {
    idle: "bg-slate-100 text-slate-500 dark:bg-slate-700/70 dark:text-slate-400",
    ready:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    playing:
      "bg-lime-100 text-lime-700 animate-pulse dark:bg-lime-950 dark:text-lime-300",
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 flex-1">
      <header className="mb-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-900 via-emerald-600 to-teal-500 px-6 py-9 text-center shadow-xl shadow-emerald-900/20 ring-1 ring-emerald-900/10">
          <div className="pointer-events-none absolute -top-16 -left-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-lime-300/20 blur-3xl" />
          <h1 className="relative text-3xl font-bold tracking-wide text-white drop-shadow-md sm:text-4xl">
            โหมด Tournament
          </h1>
          <p className="relative mt-2 text-sm text-emerald-100/90">
            หมุนคู่แบบรอบครบทุกคู่ — แต้ม = ผลต่างของสกอร์ (21−17 → +4 / −4)
          </p>
          <div className="relative mt-3">
            <Link
              href="/"
              className="rounded-full bg-white/15 px-4 py-1.5 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-white/25"
            >
              ⌂ กลับไปโหมดปกติ
            </Link>
          </div>
        </div>
      </header>

      {done &&
        (app.finishedAt ? (
          <div className="mb-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-center dark:border-emerald-700 dark:bg-emerald-950/40">
            <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
              🏁 Tournament จบแล้ว — ทุกคู่ได้เล่นครบ
            </p>
            <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
              ดูอันดับตารางคะแนนหรือกด “เริ่มใหม่” เพื่อเล่นรอบใหม่
            </p>
          </div>
        ) : null)}

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-80 lg:shrink-0">
          <div className="space-y-4 lg:sticky lg:top-6">
            <section className="rounded-2xl bg-white p-5 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-emerald-500 to-teal-400" />
                  <h2 className="font-semibold text-slate-700 dark:text-slate-200">
                    รายชื่อ ({rosterTotal})
                  </h2>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  {unlockedArrived} มาแล้ว
                </span>
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                <button
                  onClick={checkAllPresence}
                  className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-300 dark:hover:bg-emerald-900"
                >
                  ✓ เช็คชื่อทุกคน
                </button>
                <button
                  onClick={resetTournament}
                  className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100 dark:bg-rose-950/70 dark:text-rose-300 dark:hover:bg-rose-900"
                >
                  เริ่มใหม่
                </button>
                <button
                  onClick={clearRoster}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                >
                  เคลียร์รายชื่อ
                </button>
              </div>
              {rosterTotal === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  ยังไม่มีสมาชิก — เพิ่มชื่อด้านล่างก่อน
                </p>
              ) : (
                <ul className={`sidebar-scroll space-y-1.5 ${rosterTotal > 10 ? "max-h-[26rem] overflow-y-auto pr-1" : ""}`}>
                  {app.members.map((name) => {
                    const arrived = isArrived(app, name);
                    const pts = app.scores?.[name] ?? 0;
                    const gcount = playedOf(app, name);
                    return (
                      <li
                        key={name}
                        className={`flex select-none items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all ${
                          arrived
                            ? "border-slate-100 bg-white hover:border-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-emerald-700"
                            : "border-slate-100 bg-slate-50/60 dark:border-slate-700/80 dark:bg-slate-800/50"
                        }`}
                      >
                        <button
                          onClick={() => togglePresence(name)}
                          aria-label={`เช็คชื่อ ${name}`}
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold transition-all ${
                            arrived
                              ? "border-emerald-500 bg-emerald-500 text-white"
                              : "border-slate-300 bg-white text-slate-300 hover:border-emerald-400 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-500"
                          }`}
                        >
                          ✓
                        </button>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-1.5">
                            <span
                              className={`min-w-0 truncate text-[15px] font-semibold ${
                                arrived
                                  ? "text-slate-700 dark:text-slate-200"
                                  : "text-slate-400 line-through dark:text-slate-500"
                              }`}
                            >
                              {name}
                            </span>
                            <span className="shrink-0 text-xs font-normal tabular-nums text-slate-400 dark:text-slate-500">
                              ({gcount} เกม)
                            </span>
                          </span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-1">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                                pts > 0
                                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                  : pts < 0
                                    ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                                    : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                              }`}
                            >
                              {pts > 0 ? `+${pts}` : pts} แต้ม
                            </span>
                            {!arrived && (
                              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                ยังไม่มา
                              </span>
                            )}
                          </span>
                        </span>
                        <button
                          onClick={() => removeMember(name)}
                          aria-label={`ลบ ${name}`}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400 transition-colors hover:bg-rose-100 hover:text-rose-600 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-rose-950/70 dark:hover:text-rose-300"
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-2xl bg-white p-5 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-emerald-500 to-teal-400" />
                <h2 className="font-semibold text-slate-700 dark:text-slate-200">
                  เพิ่มชื่อ
                </h2>
              </div>
              <div className="flex gap-2">
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addMember()}
                  placeholder="ชื่อสมาชิก"
                  className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
                <button
                  onClick={addMember}
                  className="shrink-0 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700"
                >
                  เพิ่ม
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
                คนที่เพิ่มใหม่ต้องกด ✓ เช็คชื่อก่อนถึงจะเข้าสุ่มคู่ได้
              </p>
            </section>
          </div>
        </aside>

        <section className="flex-1 space-y-4">
          <div className="flex items-center justify-between rounded-2xl bg-white p-4 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
            <div className="flex items-center gap-2">
              <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-emerald-500 to-teal-400" />
              <h2 className="font-semibold text-slate-700 dark:text-slate-200">
                คอร์ด ({app.courts.length})
              </h2>
            </div>
            <div className="flex gap-2">
              <button
                onClick={drawAllIdle}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700"
              >
                สุ่มทุกคอร์ด
              </button>
              <button
                onClick={removeCourt}
                disabled={app.courts.length <= 1}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              >
                ลดคอร์ด
              </button>
              <button
                onClick={addCourt}
                disabled={app.courts.length >= MAX_COURTS}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                เพิ่มคอร์ด
              </button>
            </div>
          </div>

          {totalPairs > 0 && (
            <div className="rounded-2xl bg-white p-4 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  คู่ที่เล่นครบแล้ว {usedPairs.size}/{totalPairs} คู่
                </span>
                <span className="text-xs text-slate-400 dark:text-slate-500">
                  {Math.floor(progress * 100)}%
                </span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, progress * 100)}%` }}
                />
              </div>
            </div>
          )}

          {app.courts.map((court, idx) => {
            const teamBox = (
              names: string[],
              color: string,
              bg: string
            ) => (
              <div
                className={`flex flex-1 flex-col gap-2 rounded-2xl border p-3 ${bg}`}
              >
                {names.length > 0 ? (
                  names.map((n) => (
                    <span
                      key={n}
                      className={`rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold shadow-sm dark:bg-slate-800 ${color}`}
                    >
                      {n}
                    </span>
                  ))
                ) : (
                  <span className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-center text-sm font-semibold text-slate-300 dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-500">
                    ว่าง
                  </span>
                )}
              </div>
            );
            return (
              <div
                key={idx}
                className="rounded-2xl bg-white p-6 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700"
              >
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-600 to-teal-500 text-sm font-bold text-white shadow-md shadow-emerald-600/25">
                      {idx + 1}
                    </span>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">
                      คอร์ด {idx + 1}
                    </h3>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${statusPill[court.status]}`}
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    {court.status === "idle"
                      ? "ยังไม่จับคู่"
                      : court.status === "ready"
                        ? "พร้อมเล่น"
                        : "กำลังเล่น"}
                  </span>
                </div>

                {court.status === "idle" ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 dark:border-slate-700 dark:bg-slate-800/50">
                    <p className="text-sm font-medium text-slate-400 dark:text-slate-500">
                      ผู้เล่นว่าง {freePlayers.length} คน
                    </p>
                    <button
                      onClick={() => drawCourt(idx)}
                      disabled={freePlayers.length < 4}
                      className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      สุ่มคู่
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-stretch gap-3">
                      {teamBox(court.a, "text-emerald-800 dark:text-emerald-300", "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/40")}
                      <div className="flex items-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 text-sm font-extrabold text-white shadow-md shadow-rose-500/30">
                          VS
                        </span>
                      </div>
                      {teamBox(court.b, "text-sky-800 dark:text-sky-300", "border-sky-200 bg-sky-50/60 dark:border-sky-800/60 dark:bg-sky-950/40")}
                    </div>

                    {court.status === "ready" && (
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                        <button
                          onClick={() => startCourt(idx)}
                          className="rounded-xl bg-lime-600 px-6 py-2.5 font-semibold text-white shadow-md shadow-lime-600/25 transition-all hover:-translate-y-0.5 hover:bg-lime-700"
                        >
                          เริ่มเกม
                        </button>
                        <button
                          onClick={() => drawCourt(idx)}
                          className="rounded-xl bg-slate-100 px-6 py-2.5 font-semibold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                        >
                          สุ่มใหม่
                        </button>
                        <button
                          onClick={() => clearCourt(idx)}
                          className="rounded-xl bg-rose-50 px-6 py-2.5 font-semibold text-rose-600 hover:bg-rose-100 dark:bg-rose-950/70 dark:text-rose-300 dark:hover:bg-rose-900"
                        >
                          ยกเลิก
                        </button>
                      </div>
                    )}

                    {court.status === "playing" && (
                      <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50/60 p-4 dark:border-sky-800/60 dark:bg-sky-950/40">
                        <div className="flex items-stretch gap-3">
                          {scoreInput(idx, "a", "ทีม A", court.a)}
                          <div className="flex items-center">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 text-xs font-extrabold text-white">
                              VS
                            </span>
                          </div>
                          {scoreInput(idx, "b", "ทีม B", court.b)}
                        </div>
                        <p className="mt-2 text-center text-[11px] text-sky-600 dark:text-sky-400">
                          ผู้ชนะได้แต้ม = ผลต่าง (เช่น 21:17 → +4 / −4)
                        </p>
                          <div className="mt-3 flex justify-center gap-3">
                            <button
                              onClick={() => endGame(idx)}
                              className="rounded-xl bg-emerald-600 px-6 py-2.5 font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700"
                            >
                              บันทึกพร้อมจบเกม
                            </button>
                            <button
                              onClick={() => clearCourt(idx)}
                              className="rounded-xl bg-slate-100 px-6 py-2.5 font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                            >
                              ยกเลิก
                            </button>
                          </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {standings.length > 0 && (
            <section className="rounded-2xl bg-white p-5 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-amber-500 to-amber-400" />
                <h2 className="font-semibold text-slate-700 dark:text-slate-200">
                  ตารางคะแนน
                </h2>
              </div>
              <ul className="sidebar-scroll space-y-1.5">
                {standings.map((s, i) => (
                  <li
                    key={s.name}
                    className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 ${
                      i === 0
                        ? "border-amber-200 bg-amber-50/80 dark:border-amber-700/60 dark:bg-amber-950/40"
                        : "border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-800"
                    }`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        i === 0
                          ? "bg-amber-400 text-amber-900"
                          : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                      {s.name}
                    </span>
                    <span className="text-[11px] text-slate-400 dark:text-slate-500">
                      {s.games} เกม · {s.wins} ชนะ
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                        s.pts > 0
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                          : s.pts < 0
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                            : "bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400"
                      }`}
                    >
                      {s.pts > 0 ? `+${s.pts}` : s.pts}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </section>
      </div>

      <footer className="mt-8 text-center text-xs text-slate-400 dark:text-slate-500">
        ก๊วน CS KhemKhang · KuanBad · Tournament
      </footer>
    </main>
  );
}
