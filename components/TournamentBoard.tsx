"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const MAX_COURTS = 10;
const POLL_MS = 1500;
const STORAGE_KEY = "kuanbad-tournament";
const STATE_URL = "/api/tstate";

interface TCourt {
  t1: number;
  t2: number;
  status: "idle" | "ready" | "playing";
  startAt: number | null;
}

interface TGameRow {
  ts: number;
  t1: number;
  t2: number;
  sa: number;
  sb: number;
}

interface TournamentState {
  members: string[];
  presence: Record<string, boolean>;
  scores: Record<string, number>;
  teams: string[][];
  games: TGameRow[];
  courts: TCourt[];
  finishedAt: number | null;
}

const emptyCourt = (): TCourt => ({
  t1: -1,
  t2: -1,
  status: "idle",
  startAt: null,
});

const defaultState = (): TournamentState => ({
  members: [],
  presence: {},
  scores: {},
  teams: [],
  games: [],
  courts: Array.from({ length: 2 }, emptyCourt),
  finishedAt: null,
});

const nowMs = () => Date.now();
const rand01 = () => Math.random();

const pairwise = (st: TournamentState) =>
  st.teams.length * (st.teams.length - 1) * 0.5;

const matchupKey = (a: number, b: number) =>
  a < b ? `${a}::${b}` : `${b}::${a}`;

const playedMatchups = (st: TournamentState) => {
  const s = new Set<string>();
  st.games.forEach((g) => s.add(matchupKey(g.t1, g.t2)));
  return s;
};

const isArrived = (st: TournamentState, n: string) =>
  st.presence?.[n] ?? true;

const playerGames = (st: TournamentState, n: string) =>
  st.games.filter(
    (g) =>
      st.teams[g.t1]?.includes(n) || st.teams[g.t2]?.includes(n)
  ).length;

const teamGames = (st: TournamentState, t: number) =>
  st.games.filter((g) => g.t1 === t || g.t2 === t).length;

function normalizeState(st: TournamentState): TournamentState {
  return {
    ...st,
    members: st.members ?? [],
    presence: st.presence ?? {},
    scores: st.scores ?? {},
    teams: Array.isArray(st.teams) ? st.teams.filter((t) => Array.isArray(t)) : [],
    games: st.games ?? [],
    courts:
      Array.isArray(st.courts) && st.courts.length >= 1
        ? st.courts.map((c) =>
            c && typeof c.t1 === "number" && typeof c.t2 === "number"
              ? c
              : emptyCourt()
          )
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
  const [app, setApp] = useState<TournamentState>(() =>
    persisted ? normalizeState(persisted) : defaultState()
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

  const arrivedMembers = app.members.filter((n) => isArrived(app, n));
  const unpaired = arrivedMembers.filter(
    (n) => !app.teams.some((t) => t.includes(n))
  );
  const doneMatchups = playedMatchups(app);
  const totalMatchups = pairwise(app);
  const progress =
    totalMatchups > 0 ? doneMatchups.size / totalMatchups : 0;
  const finished =
    totalMatchups > 0 && doneMatchups.size >= totalMatchups;

  const busyTeams = useMemo(() => {
    const s = new Set<number>();
    app.courts.forEach((c) => {
      if (c.status !== "idle") {
        if (c.t1 >= 0) s.add(c.t1);
        if (c.t2 >= 0) s.add(c.t2);
      }
    });
    return s;
  }, [app.courts]);

  const standings = useMemo(
    () =>
      app.members
        .map((n) => ({
          name: n,
          pts: app.scores?.[n] ?? 0,
          games: playerGames(app, n),
          wins: app.games.filter((g) => {
            const inA = app.teams[g.t1]?.includes(n);
            const inB = app.teams[g.t2]?.includes(n);
            return inA ? g.sa > g.sb : inB ? g.sb > g.sa : false;
          }).length,
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
    if (app.teams.some((t) => t.includes(name))) {
      alert("คนนี้ถูกจับคู่แล้ว — เคลียร์การจับคู่/เริ่มใหม่ก่อน");
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
    if (busyTeams.size > 0) {
      alert("มีคู่ทีมอยู่ในคอร์ดอยู่ — เคลียร์คอร์ดก่อน");
      return;
    }
    if (!window.confirm("ลบรายชื่อทั้งหมด? (ลบสมาชิก แต้ม และประวัติเกม)")) return;
    setScores({});
    commit((prev) => ({
      ...prev,
      members: [],
      presence: {},
      scores: {},
      teams: [],
      games: [],
      finishedAt: null,
      courts: prev.courts.map(() => emptyCourt()),
    }));
  };

  const resetTournament = () => {
    if (!window.confirm("เริ่ม tournament ใหม่? (ล้างแต้ม เกม คอร์ด และการจับคู่)"))
      return;
    setScores({});
    commit((prev) => ({
      ...prev,
      scores: {},
      teams: [],
      games: [],
      finishedAt: null,
      courts: prev.courts.map(() => emptyCourt()),
    }));
  };

  const drawTeams = () => {
    const st = appRef.current;
    if (busyTeams.size > 0) {
      alert("มีคู่ทีมอยู่ในคอร์ดอยู่ — รอเคลียร์คอร์ดก่อนจับคู่ใหม่");
      return;
    }
    const arrived = st.members.filter((n) => isArrived(st, n));
    if (arrived.length < 4) {
      alert("ต้องมีสมาชิกที่เช็คชื่อแล้วอย่างน้อย 4 คน");
      return;
    }
    const pool = [...arrived];
    const teams: string[][] = [];
    while (pool.length >= 2) {
      const i = Math.floor(rand01() * pool.length);
      const p1 = pool.splice(i, 1)[0];
      const j = Math.floor(rand01() * pool.length);
      const p2 = pool.splice(j, 1)[0];
      teams.push([p1, p2]);
    }
    commit((prev) => ({
      ...prev,
      teams,
      games: [],
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

  const drawMatch = (idx: number) => {
    const st = appRef.current;
    if (st.teams.length < 2) return;
    const played = playedMatchups(st);

    const candidates = st.teams
      .map((_, t) => t)
      .filter((t) => !busyTeams.has(t))
      .filter((t) => t < st.teams.length && st.teams[t].length === 2);

    const now = nowMs();
    const lastPlay = (t: number) =>
      st.games.reduce(
        (m, g) => (g.t1 === t || g.t2 === t ? Math.max(m, g.ts) : m),
        0
      );
    const rested = candidates.filter((t) => now - lastPlay(t) >= 60_000);
    const source = rested.length >= 2 ? rested : candidates;
    if (source.length < 2) return;

    const minGames = Math.min(...source.map((t) => teamGames(st, t)));
    const weightOf = (t: number) => {
      const diff = teamGames(st, t) - minGames;
      return [4, 2.5, 1.2, 0.6, 0.3, 0.2][Math.min(diff, 5)];
    };

    const samplePair = (): [number, number] | null => {
      const left = [...source];
      const out: number[] = [];
      while (out.length < 2 && left.length > 0) {
        let total = 0;
        for (const t of left) total += Math.max(weightOf(t), 0.001);
        if (total <= 0) break;
        let r = rand01() * total;
        let chosen = left[left.length - 1];
        for (const t of left) {
          r -= Math.max(weightOf(t), 0.001);
          if (r <= 0) {
            chosen = t;
            break;
          }
        }
        out.push(chosen);
        left.splice(left.indexOf(chosen), 1);
      }
      return out.length === 2 ? ([out[0], out[1]] as [number, number]) : null;
    };

    let best: [number, number] | null = null;
    for (let t = 0; t < 80; t++) {
      const pair = samplePair();
      if (!pair) break;
      if (played.has(matchupKey(pair[0], pair[1]))) continue;
      best = pair;
      break;
    }
    if (!best) {
      best = samplePair();
    }
    if (!best) return;
    const [a, b] = best;
    commit((prev) => {
      if (idx >= prev.courts.length) return prev;
      const courts = [...prev.courts];
      courts[idx] = { t1: a, t2: b, status: "ready", startAt: null };
      return { ...prev, courts };
    });
  };

  const drawAllIdle = () => {
    app.courts.forEach((c, i) => {
      if (c.status === "idle") drawMatch(i);
    });
  };

  const startCourt = (idx: number) =>
    commit((prev) => {
      if (idx >= prev.courts.length) return prev;
      const courts = [...prev.courts];
      courts[idx] = { ...courts[idx], status: "playing", startAt: nowMs() };
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
    if (!c || c.t1 < 0 || c.t2 < 0) return;
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
    const teamA = [...(st.teams[c.t1] ?? [])];
    const teamB = [...(st.teams[c.t2] ?? [])];
    const winA = sa > sb;
    const wTeam = winA ? teamA : teamB;
    const lTeam = winA ? teamB : teamA;
    commit((prev) => {
      const games = [
        ...prev.games,
        { ts: nowMs(), t1: c.t1, t2: c.t2, sa, sb },
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
      const used = playedMatchups({ ...prev, games });
      const total = pairwise(prev);
      const finishedAt =
        prev.finishedAt ??
        (total > 0 && used.size >= total ? nowMs() : null);
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

  const teamLabel = (t: number) =>
    t >= 0 && app.teams[t] ? app.teams[t].join(" × ") : "—";

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
            จับคู่ประจำ แล้วหมุนทีมชนกันครบทุกคู่จนจบ — แต้ม = ผลต่าง (21−17 → +4 / −4)
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

      {finished && app.finishedAt && (
        <div className="mb-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-center dark:border-emerald-700 dark:bg-emerald-950/40">
          <p className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
            Tournament จบแล้ว — ทุกทีมได้เจอกันครบแล้ว
          </p>
          <p className="mt-1 text-xs text-emerald-600 dark:text-emerald-400">
            ดูอันดับตารางคะแนนหรือกด “เริ่มใหม่” เพื่อเริ่มรอบใหม่
          </p>
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-80 lg:shrink-0">
          <div className="space-y-4 lg:sticky lg:top-6">
            <section className="rounded-2xl bg-white p-5 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-emerald-500 to-teal-400" />
                  <h2 className="font-semibold text-slate-700 dark:text-slate-200">
                    รายชื่อ ({app.members.length})
                  </h2>
                </div>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  {arrivedMembers.length} มาแล้ว
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
              {app.members.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500">
                  ยังไม่มีสมาชิก — เพิ่มชื่อด้านล่างก่อน
                </p>
              ) : (
                <ul className={`sidebar-scroll space-y-1.5 ${app.members.length > 10 ? "max-h-[24rem] overflow-y-auto pr-1" : ""}`}>
                  {app.members.map((name) => {
                    const arrived = isArrived(app, name);
                    const pts = app.scores?.[name] ?? 0;
                    const gcount = playerGames(app, name);
                    const isPaired = app.teams.some((t) => t.includes(name));
                    return (
                      <li
                        key={name}
                        className={`flex select-none items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all ${
                          isPaired
                            ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-800/70 dark:bg-emerald-950/40"
                            : arrived
                              ? "border-slate-100 bg-white dark:border-slate-700 dark:bg-slate-800"
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
                            {isPaired && (
                              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                มีคู่แล้ว
                              </span>
                            )}
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
                คนที่เพิ่มใหม่ต้องกด ✓ เช็คชื่อก่อน แล้วกด “สุ่มคู่ประจำ” เพื่อจับคู่ประจำ
              </p>
            </section>
          </div>
        </aside>

        <section className="flex-1 space-y-4">
          <section className="rounded-2xl bg-white p-5 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-amber-500 to-amber-400" />
                <h2 className="font-semibold text-slate-700 dark:text-slate-200">
                  คู่ประจำ ({app.teams.length} คู่)
                </h2>
              </div>
              <button
                onClick={drawTeams}
                disabled={arrivedMembers.length < 4}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                สุ่มคู่ประจำ
              </button>
            </div>
            {app.teams.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                ยังไม่มีการจับคู่ — กด “สุ่มคู่ประจำ” จับคู่ทั้งหมด (เล่นคู่กันจนจบ tournament)
              </p>
            ) : (
              <>
                <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {app.teams.map((team, t) => (
                    <li
                      key={t}
                      className={`rounded-xl border px-3 py-2 text-center ${
                        team.length === 2
                          ? "border-emerald-200 bg-emerald-50/70 dark:border-emerald-800/70 dark:bg-emerald-950/40"
                          : "border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50"
                      }`}
                    >
                      <div className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                        ทีม {t + 1}
                      </div>
                      <div className="mt-0.5 text-sm font-bold text-emerald-800 dark:text-emerald-300">
                        {teamLabel(t)}
                      </div>
                      <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                        ชนะ {teamGames(app, t)}/เล่น {teamGames(app, t) / 2}
                      </div>
                    </li>
                  ))}
                </ul>
                {unpaired.length > 0 && (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-300">
                    {unpaired.length} คนยังไม่มีคู่: {unpaired.join(" · ")} — กด
                    “สุ่มคู่ประจำ” อีกครั้ง (หรือรอคนมาครบ)
                  </p>
                )}
              </>
            )}
          </section>

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
                disabled={app.teams.length < 2}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                สุ่มคู่แข่งทุกคอร์ด
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

          {totalMatchups > 0 && (
            <div className="rounded-2xl bg-white p-4 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-600 dark:text-slate-300">
                  ทีม-ทีมที่เจอกันแล้ว {doneMatchups.size}/{totalMatchups} คู่
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
            const teamBox = (t: number, color: string, bg: string) => (
              <div className={`flex flex-1 flex-col gap-2 rounded-2xl border p-3 ${bg}`}>
                {t >= 0 && app.teams[t] ? (
                  <>
                    <span className="text-center text-[10px] font-semibold text-slate-400 dark:text-slate-500">
                      ทีม {t + 1}
                    </span>
                    {app.teams[t].map((n) => (
                      <span
                        key={n}
                        className={`rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold shadow-sm dark:bg-slate-800 ${color}`}
                      >
                        {n}
                      </span>
                    ))}
                  </>
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
                      ? "ยังไม่จับคู่แข่ง"
                      : court.status === "ready"
                        ? "พร้อมเล่น"
                        : "กำลังเล่น"}
                  </span>
                </div>

                {court.status === "idle" ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-4 py-6 dark:border-slate-700 dark:bg-slate-800/50">
                    <p className="text-sm font-medium text-slate-400 dark:text-slate-500">
                      ไม่มีคู่ทีมอยู่ในคอร์ด
                    </p>
                    <button
                      onClick={() => drawMatch(idx)}
                      disabled={app.teams.length < 2}
                      className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      สุ่มคู่แข่ง
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-stretch gap-3">
                      {teamBox(court.t1, "text-emerald-800 dark:text-emerald-300", "border-emerald-200 bg-emerald-50/60 dark:border-emerald-800/60 dark:bg-emerald-950/40")}
                      <div className="flex items-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 text-sm font-extrabold text-white shadow-md shadow-rose-500/30">
                          VS
                        </span>
                      </div>
                      {teamBox(court.t2, "text-sky-800 dark:text-sky-300", "border-sky-200 bg-sky-50/60 dark:border-sky-800/60 dark:bg-sky-950/40")}
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
                          onClick={() => drawMatch(idx)}
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
                          {scoreInput(idx, "a", `ทีม ${court.t1 + 1}`, app.teams[court.t1] ?? [])}
                          <div className="flex items-center">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 text-xs font-extrabold text-white">
                              VS
                            </span>
                          </div>
                          {scoreInput(idx, "b", `ทีม ${court.t2 + 1}`, app.teams[court.t2] ?? [])}
                        </div>
                        <p className="mt-2 text-center text-[11px] text-sky-600 dark:text-sky-400">
                          ผู้ชนะในทีมทั้งคู่ได้ +ผลต่าง ผู้แพ้ −ผลต่าง (เช่น 21:17 → +4 / −4)
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
