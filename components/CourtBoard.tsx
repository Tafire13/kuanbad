"use client";

import { useEffect, useMemo, useRef, useState } from "react";

const DEFAULT_MEMBERS: string[] = [];

const MAX_COURTS = 10;
const POLL_MS = 1500;

interface CourtBoardProps {
  stateUrl?: string;
  storageKey?: string;
  title?: string;
  subtitle?: string;
}

type CourtStatus = "idle" | "ready" | "playing" | "done";

interface CourtState {
  teamA: string[];
  teamB: string[];
  status: CourtStatus;
  startAt: number | null;
  endedAt: number | null;
}

interface AppState {
  members: string[];
  courts: CourtState[];
  sessionGames: Record<string, number>;
  lastPartner: Record<string, string>;
  partnerHistory: Record<string, string[]>;
  waitingSince: Record<string, number>;
  presence: Record<string, boolean>;
}

const emptyCourt = (): CourtState => ({
  teamA: [],
  teamB: [],
  status: "idle",
  startAt: null,
  endedAt: null,
});

const defaultState = (): AppState => ({
  members: DEFAULT_MEMBERS,
  courts: Array.from({ length: 2 }, emptyCourt),
  sessionGames: {},
  lastPartner: {},
  partnerHistory: {},
  waitingSince: {},
  presence: {},
});

const isArrived = (st: AppState, n: string) => st.presence?.[n] ?? true;

function normalizeState(st: AppState): AppState {
  const partnerHistory = st.partnerHistory ?? {};
  if (Object.keys(partnerHistory).length === 0 && st.lastPartner) {
    Object.entries(st.lastPartner).forEach(([k, v]) => {
      if (v) partnerHistory[k] = [v];
    });
  }
  return {
    ...st,
    members: st.members ?? [],
    courts: st.courts ?? [],
    sessionGames: st.sessionGames ?? {},
    lastPartner: st.lastPartner ?? {},
    partnerHistory,
    waitingSince: st.waitingSince ?? {},
    presence: st.presence ?? {},
  };
}

function loadLocal(storageKey: string): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const st = JSON.parse(raw) as AppState;
    if (
      st &&
      Array.isArray(st.members) &&
      Array.isArray(st.courts) &&
      st.sessionGames &&
      st.lastPartner
    ) {
      return normalizeState({
        ...st,
        partnerHistory: st.partnerHistory ?? {},
        waitingSince: st.waitingSince ?? {},
      });
    }
  } catch {
    /* ignore */
  }
  return null;
}

function persistLocal(storageKey: string, st: AppState) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(st));
  } catch {
    /* ignore */
  }
}

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

const nowMs = () => Date.now();

const STATUS_LABEL: Record<CourtStatus, string> = {
  idle: "ยังไม่จับคู่",
  ready: "พร้อมเล่น",
  playing: "กำลังเล่น",
  done: "เล่นจบแล้ว",
};

function repeatScore(st: AppState, a: string, b: string): number {
  if (!a || !b) return 0;
  const hs = st.partnerHistory?.[a] ?? [];
  let s = 0;
  const len = hs.length;
  for (let i = 0; i < len; i++) {
    if (hs[i] === b) s += Math.pow(0.5, len - 1 - i);
  }
  return s;
}

function repeatPartnerPair(
  st: AppState,
  c: CourtState
): [string, string] | null {
  const pairs: [string, string][] = [
    [c.teamA[0], c.teamA[1]],
    [c.teamB[0], c.teamB[1]],
  ];
  let best: [string, string] | null = null;
  let bestScore = 0;
  for (const [a, b] of pairs) {
    const s = repeatScore(st, a, b);
    if (s > bestScore) {
      bestScore = s;
      best = [a, b];
    }
  }
  return best;
}

function swapTwoInCourt(c: CourtState, n1: string, n2: string) {
  const loc = (n: string): ["A" | "B", number] | null => {
    const a = c.teamA.indexOf(n);
    if (a >= 0) return ["A", a];
    const b = c.teamB.indexOf(n);
    return b >= 0 ? ["B", b] : null;
  };
  const l1 = loc(n1);
  const l2 = loc(n2);
  if (!l1 || !l2) return null;
  const teamA = [...c.teamA];
  const teamB = [...c.teamB];
  (l1[0] === "A" ? teamA : teamB)[l1[1]] = n2;
  (l2[0] === "A" ? teamA : teamB)[l2[1]] = n1;
  return { teamA, teamB };
}

function replacedTeams(c: CourtState, out: string, inn: string) {
  const teamA = [...c.teamA];
  const teamB = [...c.teamB];
  const ia = teamA.indexOf(out);
  if (ia >= 0) teamA[ia] = inn;
  else {
    const ib = teamB.indexOf(out);
    if (ib >= 0) teamB[ib] = inn;
  }
  return { teamA, teamB };
}

function countTeamConflicts(
  st: AppState,
  teamA: string[],
  teamB: string[]
): number {
  return repeatScore(st, teamA[0], teamA[1]) + repeatScore(st, teamB[0], teamB[1]);
}

export default function CourtBoard({
  stateUrl = "/api/state",
  storageKey = "kuanbad-app",
  title = "ก๊วน CS KhemKhang",
  subtitle,
}: CourtBoardProps) {
  const persisted = loadLocal(storageKey ?? "kuanbad-app");
const [app, setApp] = useState<AppState>(persisted ?? defaultState());
  const [, setOnline] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [newName, setNewName] = useState("");
  const [shuffling, setShuffling] = useState<number[]>([]);
  const [rollNames, setRollNames] = useState<Record<number, string[]>>({});
  const [rollTick, setRollTick] = useState(0);
  const [swapCourt, setSwapCourt] = useState<number | null>(null);
  const [swapOut, setSwapOut] = useState<string | null>(null);
  const [dragName, setDragName] = useState<string | null>(null);
  const [hoverDrop, setHoverDrop] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<{
    court: number | null;
    status: CourtStatus | null;
  } | null>(null);
  const [ghost, setGhost] = useState<{
    name: string;
    x: number;
    y: number;
  } | null>(null);
  const rollTimersRef = useRef<Record<number, ReturnType<typeof setInterval>>>(
    {}
  );
  const appRef = useRef(app);
  const revRef = useRef<number | null>(null);
  const pendingRef = useRef(false);
  const bootedRef = useRef(false);
  const pushChainRef = useRef<Promise<void>>(Promise.resolve());
  const dragRef = useRef<{ name: string; fromCourt: number | null } | null>(
    null
  );
  const suppressClickRef = useRef(false);

  useEffect(
    () => () => {
      Object.values(rollTimersRef.current).forEach((t) => clearInterval(t));
    },
    []
  );

  const setBoth = (st: AppState) => {
    appRef.current = st;
    setApp(st);
    persistLocal(storageKey, st);
  };

  const commit = (updater: (prev: AppState) => AppState) => {
    const next = updater(appRef.current);
    setBoth(next);
    pushChainRef.current = pushChainRef.current.then(async () => {
      pendingRef.current = true;
      try {
        const res = await fetch(stateUrl, {
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
        const res = await fetch(stateUrl);
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
          setOnline(true);
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

useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const lockedPlayers = (st: AppState, exceptIdx: number): Set<string> => {
    const s = new Set<string>();
    st.courts.forEach((c, i) => {
      if (i === exceptIdx) return;
      if (c.status === "ready" || c.status === "playing" || c.status === "done") {
        [...c.teamA, ...c.teamB].forEach((n) => s.add(n));
      }
      if (shuffling.includes(i)) {
        (rollNames[i] ?? []).forEach((n) => s.add(n));
      }
    });
    return s;
  };

  const poolFor = (st: AppState, idx: number) =>
    st.members.filter(
      (n) => isArrived(st, n) && !lockedPlayers(st, idx).has(n)
    );

  const inCourt = useMemo(() => {
    const s = new Set<string>();
    app.courts.forEach((c) => {
      if (c.status !== "idle") {
        [...c.teamA, ...c.teamB].forEach((n) => s.add(n));
      }
    });
    return s;
  }, [app.courts]);

  const freePlayers = app.members.filter(
    (n) => isArrived(app, n) && !inCourt.has(n)
  );
  const unArrivedCount = app.members.filter((n) => !isArrived(app, n)).length;
  const playingPlayers = useMemo(
    () =>
      new Set(
        app.courts
          .filter((c) => c.status === "playing")
          .flatMap((c) => [...c.teamA, ...c.teamB])
      ),
    [app.courts]
  );

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

  const clearCourts = () => {
    if (!window.confirm("เคลียร์คู่ในทุกคอร์ด?")) return;
    Object.values(rollTimersRef.current).forEach((t) => clearInterval(t));
    rollTimersRef.current = {};
    setShuffling([]);
    setRollNames({});
    commit((prev) => ({
      ...prev,
      courts: prev.courts.map(() => emptyCourt()),
    }));
  };

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
      presence: {
        ...(prev.presence ?? {}),
        [name]: !isArrived(prev, name),
      },
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
    if (inCourt.has(name)) {
      alert("คนนี้อยู่ในคอร์ดอยู่ — เคลียร์คอร์ดก่อน");
      return;
    }
    if (!window.confirm(`ลบ "${name}" ออกจากสมาชิก?`)) return;
    commit((prev) => {
      const sessionGames = { ...prev.sessionGames };
      const lastPartner = { ...prev.lastPartner };
      const waitingSince = { ...prev.waitingSince };
      const partnerHistory = { ...(prev.partnerHistory ?? {}) };
      const presence = { ...(prev.presence ?? {}) };
      delete sessionGames[name];
      delete waitingSince[name];
      delete partnerHistory[name];
      delete presence[name];
      Object.keys(lastPartner).forEach((k) => {
        if (lastPartner[k] === name) delete lastPartner[k];
      });
      Object.keys(partnerHistory).forEach((k) => {
        partnerHistory[k] = partnerHistory[k].filter((n) => n !== name);
      });
      return {
        ...prev,
        members: prev.members.filter((n) => n !== name),
        sessionGames,
        lastPartner,
        partnerHistory,
        waitingSince,
        presence,
      };
    });
  };

  const clearRoster = () => {
    if (inCourt.size > 0) {
      alert("มีคนอยู่ในคอร์ดอยู่ — เคลียร์คอร์ดก่อน");
      return;
    }
    if (
      !window.confirm(
        "ลบรายชื่อทั้งหมด? (ลบสมาชิก จำนวนเกม และเวลาที่รอ)"
      )
    ) {
      return;
    }
    setSwapCourt(null);
    setSwapOut(null);
    commit((prev) => ({
      ...prev,
      members: [],
      sessionGames: {},
      lastPartner: {},
      partnerHistory: {},
      waitingSince: {},
      presence: {},
    }));
  };

  const resetSession = () => {
    if (!window.confirm("เริ่มรอบใหม่? (ล้างจำนวนเกม คู่คนล่าสุด และเวลาที่รอ)")) {
      return;
    }
    commit((prev) => ({
      ...prev,
      sessionGames: {},
      lastPartner: {},
      partnerHistory: {},
      waitingSince: {},
    }));
  };

  const pickCourtPair = (st: AppState, idx: number): string[] | null => {
    const pool = poolFor(st, idx);
    if (pool.length < 4) return null;

    const gamesOf = (n: string) => st.sessionGames[n] ?? 0;
    const minGames = Math.min(...pool.map((n) => gamesOf(n)));
    const waitingSince = st.waitingSince ?? {};
    const tNow = nowMs();

    const zeroPool = pool.filter((n) => gamesOf(n) === 0);
    const restedPool = pool.filter(
      (n) => !waitingSince[n] || (tNow - (waitingSince[n] ?? 0)) / 60000 >= 1
    );
    const sourcePool =
      zeroPool.length >= 4
        ? zeroPool
        : restedPool.length >= 4
          ? restedPool
          : pool;

    const weightOf = (n: string) => {
      const diff = gamesOf(n) - minGames;
      const wGame = diff === 0 ? 3 : diff === 1 ? 1.5 : 1;
      const wait = waitingSince[n];
      const waitMin = wait ? Math.max(0, (tNow - wait) / 60000) : 3;
      const wWait = Math.max(0.2, Math.min(1, waitMin / 2.5));
      return wGame * wWait;
    };

    const sampleWeighted = (k: number): string[] => {
      const left = [...sourcePool];
      const out: string[] = [];
      while (out.length < k && left.length > 0) {
        let total = 0;
        for (const n of left) total += Math.max(weightOf(n), 0.001);
        if (total <= 0) break;
        let r = Math.random() * total;
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

    const teamScore = (pr: [string, string][]) =>
      repeatScore(st, pr[0][0], pr[0][1]) + repeatScore(st, pr[1][0], pr[1][1]);

    const arrangeTeams = (
      four: string[]
    ): { arr: string[]; conflicts: number } => {
      const [p0, p1, p2, p3] = four;
      const pairings: [string, string][][] = [
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
      const flip = Math.random() < 0.5;
      const options = pairings.map((pr) =>
        flip ? ([pr[1], pr[0]] as [string, string][]) : pr
      );
      let best = options[0];
      let bestConflicts = Infinity;
      for (const pr of options) {
        const c = teamScore(pr);
        if (c < bestConflicts) {
          bestConflicts = c;
          best = pr;
          if (c === 0) break;
        }
      }
      return { arr: [...best[0], ...best[1]], conflicts: bestConflicts };
    };

    const current = new Set([...st.courts[idx].teamA, ...st.courts[idx].teamB]);
    const isSame4 = (four: string[]) => {
      if (four.length !== current.size) return false;
      const s = new Set(four);
      return [...current].every((n) => s.has(n));
    };

    let bestNonSame: { arr: string[]; conflicts: number } | null = null;
    for (let t = 0; t < 60; t++) {
      const four = sampleWeighted(4);
      if (four.length < 4) break;
      const res = arrangeTeams(four);
      if (isSame4(four)) continue;
      if (!bestNonSame || res.conflicts < bestNonSame.conflicts) {
        bestNonSame = res;
        if (res.conflicts === 0) return res.arr;
      }
    }
    if (bestNonSame) return bestNonSame.arr;
    return arrangeTeams(sampleWeighted(4)).arr;
  };

  const shuffleCourt = (idx: number) => {
    const st = appRef.current;
    const picked = pickCourtPair(st, idx);
    if (!picked) return;
    const pool = poolFor(st, idx);
    setShuffling((prev) => [...prev, idx]);
    setRollNames((prev) => ({ ...prev, [idx]: picked }));
    setRollTick((t) => t + 1);
    const start = nowMs();
    if (rollTimersRef.current[idx]) clearInterval(rollTimersRef.current[idx]);
    rollTimersRef.current[idx] = setInterval(() => {
      const cand = shuffle(pool).slice(0, 4);
      setRollNames((prev) => ({ ...prev, [idx]: cand }));
      setRollTick((t) => t + 1);
      if (Date.now() - start > 1600) {
        if (rollTimersRef.current[idx]) {
          clearInterval(rollTimersRef.current[idx]);
          delete rollTimersRef.current[idx];
        }
        setShuffling((prev) => prev.filter((i) => i !== idx));
        commit((prev) => {
          if (idx >= prev.courts.length) return prev;
          const next = [...prev.courts];
          next[idx] = {
            teamA: [picked[0], picked[1]],
            teamB: [picked[2], picked[3]],
            status: "ready",
            startAt: null,
            endedAt: null,
          };
          return { ...prev, courts: next };
        });
      }
    }, 90);
  };

  const startCourt = (idx: number) =>
    commit((prev) => {
      if (idx >= prev.courts.length) return prev;
      const next = [...prev.courts];
      const players = [...next[idx].teamA, ...next[idx].teamB];
      const waitingSince = { ...prev.waitingSince };
      players.forEach((n) => delete waitingSince[n]);
      next[idx] = { ...next[idx], status: "playing", startAt: Date.now() };
      return { ...prev, courts: next, waitingSince };
    });

  const endCourt = (idx: number) => {
    const c = appRef.current.courts[idx];
    if (!c || !c.startAt) return;
    commit((prev) => {
      const next = { ...prev };
      const players = [...c.teamA, ...c.teamB];
      players.forEach((n) => {
        next.sessionGames = {
          ...next.sessionGames,
          [n]: (next.sessionGames[n] ?? 0) + 1,
        };
      });
      next.lastPartner = {
        ...next.lastPartner,
        [c.teamA[0]]: c.teamA[1],
        [c.teamA[1]]: c.teamA[0],
        [c.teamB[0]]: c.teamB[1],
        [c.teamB[1]]: c.teamB[0],
      };
      const partnerOf = {
        [c.teamA[0]]: c.teamA[1],
        [c.teamA[1]]: c.teamA[0],
        [c.teamB[0]]: c.teamB[1],
        [c.teamB[1]]: c.teamB[0],
      };
      const partnerHistory = { ...(next.partnerHistory ?? {}) };
      players.forEach((n) => {
        partnerHistory[n] = [...(partnerHistory[n] ?? []), partnerOf[n]].slice(
          -10
        );
      });
      next.partnerHistory = partnerHistory;
      next.waitingSince = {
        ...next.waitingSince,
        [c.teamA[0]]: Date.now(),
        [c.teamA[1]]: Date.now(),
        [c.teamB[0]]: Date.now(),
        [c.teamB[1]]: Date.now(),
      };
      const courts = [...prev.courts];
      courts[idx] = {
        ...courts[idx],
        status: "done",
        startAt: null,
        endedAt: Date.now(),
        teamA: [],
        teamB: [],
      };
      return { ...next, courts };
    });
  };

  const doSwap = (idx: number, oldName: string, newName: string) => {
    commit((prev) => {
      if (idx >= prev.courts.length) return prev;
      if (!isArrived(prev, newName)) return prev;
      const newNameInAnother = prev.courts.some(
        (c, i) =>
          i !== idx &&
          c.status !== "idle" &&
          [...c.teamA, ...c.teamB].includes(newName)
      );
      if (newNameInAnother) return prev;
      const courts = [...prev.courts];
      const court = courts[idx];
      const aIdx = court.teamA.indexOf(oldName);
      const bIdx = court.teamB.indexOf(oldName);
      const teamA = aIdx >= 0 ? [...court.teamA] : court.teamA;
      const teamB = bIdx >= 0 ? [...court.teamB] : court.teamB;
      if (aIdx >= 0) teamA[aIdx] = newName;
      else if (bIdx >= 0) teamB[bIdx] = newName;
      courts[idx] = { ...court, teamA, teamB };
      const waitingSince = { ...prev.waitingSince };
      delete waitingSince[newName];
      if (court.status !== "ready") waitingSince[oldName] = Date.now();
      return { ...prev, courts, waitingSince };
    });
    setSwapCourt(null);
    setSwapOut(null);
  };

  const doSwapPlayers = (idx: number, n1: string, n2: string) => {
    commit((prev) => {
      if (idx >= prev.courts.length) return prev;
      const courts = [...prev.courts];
      const c = courts[idx];
      const loc = (n: string): ["A" | "B", number] | null => {
        const a = c.teamA.indexOf(n);
        if (a >= 0) return ["A", a];
        const b = c.teamB.indexOf(n);
        return b >= 0 ? ["B", b] : null;
      };
      const l1 = loc(n1);
      const l2 = loc(n2);
      if (!l1 || !l2) return prev;
      const teamA = [...c.teamA];
      const teamB = [...c.teamB];
      (l1[0] === "A" ? teamA : teamB)[l1[1]] = n2;
      (l2[0] === "A" ? teamA : teamB)[l2[1]] = n1;
      courts[idx] = { ...c, teamA, teamB };
      return { ...prev, courts };
    });
    setSwapCourt(null);
    setSwapOut(null);
  };

  const splitRepeat = (idx: number) => {
    const st = appRef.current;
    const court = st.courts[idx];
    const rep = repeatPartnerPair(st, court);
    if (!rep) return;
    const inCourtNames = [...court.teamA, ...court.teamB].filter(Boolean);
    const inCourtSet = new Set(inCourtNames);
    const others = inCourtNames.filter((n) => !rep.includes(n));
    const free = poolFor(st, idx).filter((n) => !inCourtSet.has(n));
    const candidates = [...shuffle(others), ...shuffle(free)];
    let best: { out: string; cand: string; conflicts: number } | null = null;
    for (const out of rep) {
      for (const cand of candidates) {
        if (cand === out) continue;
        const sim = inCourtSet.has(cand)
          ? swapTwoInCourt(court, out, cand)
          : replacedTeams(court, out, cand);
        if (!sim) continue;
        const conflicts = countTeamConflicts(st, sim.teamA, sim.teamB);
        if (!best || conflicts < best.conflicts) {
          best = { out, cand, conflicts };
          if (conflicts === 0) break;
        }
      }
      if (best && best.conflicts === 0) break;
    }
    if (!best) return;
    if (inCourtSet.has(best.cand)) doSwapPlayers(idx, best.out, best.cand);
    else doSwap(idx, best.out, best.cand);
  };

  const handleDrop = (
    key: string,
    name: string,
    fromCourt: number | null
  ) => {
    if (key === "bench") {
      if (fromCourt === null) return;
      commit((prev) => {
        if (fromCourt >= prev.courts.length) return prev;
        const courts = [...prev.courts];
        const sc = courts[fromCourt];
        if (sc.status !== "ready" && sc.status !== "done") return prev;
        const sa = [...sc.teamA];
        const sb = [...sc.teamB];
        const ia = sa.indexOf(name);
        if (ia >= 0) sa[ia] = "";
        else {
          const ib = sb.indexOf(name);
          if (ib < 0) return prev;
          sb[ib] = "";
        }
        courts[fromCourt] = { ...sc, teamA: sa, teamB: sb };
        return {
          ...prev,
          courts,
          waitingSince: { ...prev.waitingSince, [name]: Date.now() },
        };
      });
      return;
    }
    const [rawIdx, rawTeam, rawSlot] = key.split(":");
    const tIdx = Number(rawIdx);
    const tTeam = rawTeam as "A" | "B";
    const tSlot = Number(rawSlot);
    commit((prev) => {
      if (tIdx >= prev.courts.length) return prev;
      const target = prev.courts[tIdx];
      if (target.status === "idle") return prev;
      if (!isArrived(prev, name)) return prev;
      const nameInAnother = prev.courts.some(
        (c, i) =>
          i !== tIdx &&
          c.status !== "idle" &&
          [...c.teamA, ...c.teamB].includes(name)
      );
      if (nameInAnother) return prev;
      const occupant =
        tTeam === "A" ? target.teamA[tSlot] : target.teamB[tSlot];
      if (occupant === name) return prev;

      if (fromCourt === tIdx) {
        if (!occupant) return prev;
        const courts = [...prev.courts];
        const c = courts[tIdx];
        const loc = (n: string): ["A" | "B", number] | null => {
          const a = c.teamA.indexOf(n);
          if (a >= 0) return ["A", a];
          const b = c.teamB.indexOf(n);
          return b >= 0 ? ["B", b] : null;
        };
        const l1 = loc(name);
        const l2 = loc(occupant);
        if (!l1 || !l2) return prev;
        const teamA = [...c.teamA];
        const teamB = [...c.teamB];
        (l1[0] === "A" ? teamA : teamB)[l1[1]] = occupant;
        (l2[0] === "A" ? teamA : teamB)[l2[1]] = name;
        courts[tIdx] = { ...c, teamA, teamB };
        return { ...prev, courts };
      }

      const courts = [...prev.courts];
      let srcStatus: CourtStatus | null = null;
      if (fromCourt !== null && fromCourt < courts.length) {
        const sc = courts[fromCourt];
        const sa = [...sc.teamA];
        const sb = [...sc.teamB];
        const ia = sa.indexOf(name);
        const ib = sb.indexOf(name);
        if (ia >= 0) {
          sa[ia] = occupant;
          courts[fromCourt] = { ...sc, teamA: sa };
          srcStatus = sc.status;
        } else if (ib >= 0) {
          sb[ib] = occupant;
          courts[fromCourt] = { ...sc, teamB: sb };
          srcStatus = sc.status;
        } else {
          return prev;
        }
      }

      const ta = [...target.teamA];
      const tb = [...target.teamB];
      if (tTeam === "A") ta[tSlot] = name;
      else tb[tSlot] = name;
      courts[tIdx] = { ...target, teamA: ta, teamB: tb };

      const waitingSince = { ...prev.waitingSince };
      delete waitingSince[name];
      if (
        occupant &&
        (fromCourt === null || srcStatus === "playing" || srcStatus === "done")
      ) {
        waitingSince[occupant] = Date.now();
      }
      return { ...prev, courts, waitingSince };
    });
  };

  const pressHandlers = (
    name: string,
    fromCourt: number | null,
    fromStatus?: CourtStatus
  ) => ({
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const el = e.currentTarget;
      const timer = setTimeout(() => {
        dragRef.current = { name, fromCourt };
        setDragName(name);
        setDragFrom({ court: fromCourt, status: fromStatus ?? null });
        setGhost({ name, x: e.clientX, y: e.clientY });
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }, 250);
      const cleanup = () => {
        clearTimeout(timer);
        el.removeEventListener("pointerup", finish);
        el.removeEventListener("pointercancel", cancel);
        el.removeEventListener("pointermove", move);
      };
      const cancel = () => {
        cleanup();
        dragRef.current = null;
        setDragName(null);
        setDragFrom(null);
        setHoverDrop(null);
        setGhost(null);
      };
      const move = (ev: PointerEvent) => {
        if (!dragRef.current) return;
        setGhost((g) => (g ? { ...g, x: ev.clientX, y: ev.clientY } : g));
        const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
        const dropEl = tgt?.closest("[data-drop]") as HTMLElement | null;
        setHoverDrop(dropEl?.dataset.drop ?? null);
      };
      const finish = (ev: PointerEvent) => {
        cleanup();
        const d = dragRef.current;
        dragRef.current = null;
        setDragName(null);
        setDragFrom(null);
        setHoverDrop(null);
        setGhost(null);
        if (!d) return;
        suppressClickRef.current = true;
        setTimeout(() => {
          suppressClickRef.current = false;
        }, 350);
        const tgt = document.elementFromPoint(ev.clientX, ev.clientY);
        const dropEl = tgt?.closest("[data-drop]") as HTMLElement | null;
        const key = dropEl?.dataset.drop;
        if (key) handleDrop(key, d.name, d.fromCourt);
      };
      el.addEventListener("pointerup", finish);
      el.addEventListener("pointercancel", cancel);
      el.addEventListener("pointermove", move);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  const elapsedOf = (c: CourtState) =>
    c.startAt ? Math.max(0, Math.floor((now - c.startAt) / 1000)) : 0;

  const statusColor: Record<CourtStatus, string> = {
    idle: "bg-slate-100 text-slate-500 dark:bg-slate-700/70 dark:text-slate-400",
    ready: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    playing:
      "bg-lime-100 text-lime-700 animate-pulse dark:bg-lime-950 dark:text-lime-300",
    done: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  };

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 flex-1">
      <header className="mb-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-emerald-900 via-emerald-600 to-teal-500 px-6 py-9 text-center shadow-xl shadow-emerald-900/20 ring-1 ring-emerald-900/10">
          <div className="pointer-events-none absolute -top-16 -left-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />
          <div className="pointer-events-none absolute -bottom-20 -right-10 h-56 w-56 rounded-full bg-lime-300/20 blur-3xl" />
          <h1 className="relative text-3xl font-bold tracking-wide text-white drop-shadow-md sm:text-4xl">
            {title}
          </h1>
          <p className="relative mt-2 text-sm text-emerald-100/90">
            {subtitle ?? `จับคู่ตีแบดมินตันและจับเวลา — ${app.courts.length} คอร์ด`}
          </p>
        </div>
      </header>

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="lg:w-80 lg:shrink-0">
          <div className="space-y-4 lg:sticky lg:top-6">
            <section
              data-drop="bench"
              className={`rounded-2xl bg-white p-5 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] transition-all dark:bg-slate-800 dark:border-slate-700 ${
                dragName &&
                hoverDrop === "bench" &&
                dragFrom?.status !== "playing"
                  ? "ring-2 ring-emerald-400 ring-offset-2"
                  : ""
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-emerald-500 to-teal-400" />
                  <h2 className="font-semibold text-slate-700 dark:text-slate-200">
                    รายชื่อ ({app.members.length})
                  </h2>
                </div>
                {unArrivedCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    {unArrivedCount} ยังไม่เช็ค
                  </span>
                )}
              </div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                <button
                  onClick={checkAllPresence}
                  className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-950/70 dark:text-emerald-300 dark:hover:bg-emerald-900"
                >
                  ✓ เช็คชื่อทุกคน
                </button>
                <button
                  onClick={clearRoster}
                  className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                >
                  เคลียร์รายชื่อ
                </button>
                <button
                  onClick={resetSession}
                  className="rounded-full bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-100 dark:bg-rose-950/70 dark:text-rose-300 dark:hover:bg-rose-900"
                >
                  เริ่มรอบใหม่
                </button>
              </div>
              {unArrivedCount > 0 && (
                <p className="mb-2 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400">
                  คนที่ยังไม่เช็คชื่อจะไม่ถูกสุ่มลงเล่น — กด ✓ ที่ชื่อเมื่อมาถึง
                </p>
              )}
              {(() => {
                const waitSecOf = (n: string) => {
                  const t = (app.waitingSince ?? {})[n];
                  return t ? Math.max(0, Math.floor((now - t) / 60000)) : 0;
                };
                const maxWait = Math.max(
                  0,
                  ...app.members.map((n) => waitSecOf(n))
                );
                return (
                  <ul
                    className={`sidebar-scroll space-y-1.5 ${
                      app.members.length > 10 ? "max-h-[28rem] overflow-y-auto pr-1" : ""
                    }`}
                  >
                    {app.members.map((name) => {
                      const active = playingPlayers.has(name);
                      const arrived = isArrived(app, name);
                      const games = app.sessionGames[name] ?? 0;
                      const waitMin = waitSecOf(name);
                      const longest = waitMin > 0 && waitMin === maxWait;
                      let inCourtIdx = -1;
                      app.courts.forEach((c, i) => {
                        if (
                          c.status !== "idle" &&
                          [...c.teamA, ...c.teamB].includes(name)
                        ) {
                          inCourtIdx = i;
                        }
                      });
                      return (
                        <li
                          key={name}
                          {...pressHandlers(
                            name,
                            inCourtIdx >= 0 ? inCourtIdx : null,
                            inCourtIdx >= 0
                              ? app.courts[inCourtIdx].status
                              : undefined
                          )}
                          style={{ touchAction: "none" }}
                          className={`group flex cursor-grab select-none items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all ${
                            dragName === name
                              ? "scale-[0.98] opacity-60 ring-2 ring-rose-400"
                              : ""
                          } ${
                            arrived
                              ? inCourtIdx >= 0
                                ? "border-emerald-200 bg-emerald-50/70 hover:border-emerald-300 dark:border-emerald-800/70 dark:bg-emerald-950/40 dark:hover:border-emerald-700"
                                : "border-slate-100 bg-white hover:border-emerald-200 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-emerald-700"
                              : "border-slate-100 bg-slate-50/60 hover:border-slate-200 dark:border-slate-700/80 dark:bg-slate-800/50 dark:hover:border-slate-600"
                          }`}
                        >
                          <button
                            onClick={() => {
                              if (suppressClickRef.current) return;
                              togglePresence(name);
                            }}
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
                            <span
                              className={`block truncate text-[15px] font-semibold ${
                                arrived
                                  ? inCourtIdx >= 0
                                ? "text-emerald-800 dark:text-emerald-300"
                                : "text-slate-700 dark:text-slate-200"
                              : "text-slate-400 line-through dark:text-slate-500"
                              }`}
                            >
                              {name}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1">
                              {!arrived && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                  ยังไม่มา
                                </span>
                              )}
                              {inCourtIdx >= 0 &&
                                (active ? (
                                  <span className="rounded-full bg-lime-100 px-2 py-0.5 text-[10px] font-medium text-lime-700 dark:bg-lime-950 dark:text-lime-300">
                                    เล่นอยู่ · คอร์ด {inCourtIdx + 1}
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                    คอร์ด {inCourtIdx + 1}
                                  </span>
                                ))}
                              {!active && longest && (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                                  รอนานสุด
                                </span>
                              )}
                            </span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                              {games} เกม
                            </span>
                            {active
                              ? ""
                              : waitMin > 0
                                ? `รอ ${waitMin} นาที`
                                : games > 0
                                  ? "เพิ่งจบ"
                                  : "ยังไม่ลง"}
                          </span>
                          <button
                            onClick={() => {
                              if (suppressClickRef.current) return;
                              removeMember(name);
                            }}
                            aria-label={`ลบ ${name}`}
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-400 transition-colors hover:bg-rose-100 hover:text-rose-600 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-rose-950/70 dark:hover:text-rose-300"
                          >
                            ✕
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </section>

            <section className="rounded-2xl bg-white p-5 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-4 w-1.5 rounded-full bg-gradient-to-b from-emerald-500 to-teal-400" />
                <h2 className="font-semibold text-slate-700 dark:text-slate-200">เพิ่มชื่อ</h2>
              </div>
              <p className="mb-2 text-[11px] text-slate-400 dark:text-slate-500">
                คนที่เพิ่มใหม่ยังไม่เช็คชื่อ — กด ✓ ในรายชื่อเมื่อมาถึงแล้ว
              </p>
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
                onClick={clearCourts}
                className="rounded-lg bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-100 dark:bg-rose-950/70 dark:text-rose-300 dark:hover:bg-rose-900"
              >
                เคลียร์คอร์ด
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

          <p className="text-center text-xs text-slate-400 dark:text-slate-500">
            กดชื่อค้างไว้แล้วลากไปวางบนชื่ออื่นเพื่อสลับตำแหน่ง (ข้ามคอร์ดหรือจากคนว่างก็ได้) — ลากไปที่โซน
            “คนที่ว่าง” เพื่อถอดออกจากคอร์ด
          </p>

          {app.courts.map((court, idx) => {
            const poolCount = poolFor(app, idx).length;
            const canShuffle = poolCount >= 4;
            const repeat = repeatPartnerPair(app, court);
            const repeatSet = new Set(repeat ?? []);
            const full =
              [...court.teamA, ...court.teamB].filter(Boolean).length === 4;
            const boxCls = (
              name: string,
              dropKey: string,
              textColor: string
            ) => {
              const cls = [
                "rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold shadow-sm transition-all select-none dark:bg-slate-800",
                textColor,
              ];
              if (dragName && hoverDrop === dropKey && dragName !== name) {
                cls.push(
                  "cursor-grab -translate-y-0.5 scale-110 bg-emerald-50 shadow-lg ring-4 ring-emerald-500 dark:bg-emerald-800"
                );
              } else if (swapCourt === idx) {
                cls.push(
                  "cursor-pointer",
                  swapOut === name
                    ? "ring-2 ring-rose-500"
                    : "ring-2 ring-sky-300 hover:ring-sky-500"
                );
              } else if (dragName === name) {
                cls.push("cursor-grabbing scale-105 opacity-60");
              } else if (dragName) {
                cls.push("cursor-grab opacity-75");
              } else {
                if (repeatSet.has(name)) cls.push("ring-2 ring-amber-400");
                cls.push("cursor-grab");
              }
              return cls.join(" ");
            };
            const renderSlot = (
              team: "A" | "B",
              slot: number,
              textColor: string
            ) => {
              const name = (team === "A" ? court.teamA : court.teamB)[slot];
              const dropKey = `${idx}:${team}:${slot}`;
              if (!name) {
                const isEmptyTarget =
                  !!dragName && hoverDrop === dropKey && dragName !== name;
                return (
                  <span
                    key={dropKey}
                    data-drop={dropKey}
                    className={`rounded-xl border-2 border-dashed bg-slate-50 px-3 py-2.5 text-center text-sm font-semibold transition-all dark:bg-slate-800/60 dark:border-slate-600 ${
                      isEmptyTarget
                        ? "-translate-y-0.5 scale-110 border-emerald-500 bg-emerald-50 text-emerald-600 shadow-lg"
                        : "border-slate-300 text-slate-300 dark:border-slate-600 dark:text-slate-500"
                    }`}
                    style={{ touchAction: "none" }}
                  >
                    {isEmptyTarget ? (
                      <>
                        ว่าง
                        <span className="mt-0.5 block text-[10px] font-bold tracking-wide">
                          ⇄ {dragName}
                        </span>
                      </>
                    ) : (
                      "ว่าง"
                    )}
                  </span>
                );
              }
              return (
                <span
                  key={dropKey}
                  data-drop={dropKey}
                  onClick={
                    swapCourt === idx
                      ? () => {
                          if (suppressClickRef.current) return;
                          if (!swapOut) setSwapOut(name);
                          else if (swapOut === name) setSwapOut(null);
                          else doSwapPlayers(idx, swapOut, name);
                        }
                      : undefined
                  }
                  {...pressHandlers(name, idx, court.status)}
                  className={boxCls(name, dropKey, textColor)}
                  style={{ touchAction: "none" }}
                >
                  {name}
                  {dragName && dragName !== name && hoverDrop === dropKey && (
                    <span className="mt-0.5 block text-[10px] font-bold tracking-wide text-emerald-600">
                      ⇄ {dragName}
                    </span>
                  )}
                </span>
              );
            };
            return (
              <div
                key={idx}
                className="rounded-2xl bg-white p-6 border border-slate-100 shadow-[0_4px_20px_rgba(16,185,129,0.08)] dark:bg-slate-800 dark:border-slate-700"
              >
                <div className="flex flex-col gap-4 lg:flex-row">
                <div className="min-w-0 flex-1">
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
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold shadow-sm ${statusColor[court.status]}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full bg-current ${
                        shuffling.includes(idx) ? "animate-ping" : ""
                      }`}
                    />
                    {shuffling.includes(idx)
                      ? "กำลังสุ่ม..."
                      : STATUS_LABEL[court.status]}
                  </span>
                </div>

                {shuffling.includes(idx) ? (
                  <div className="py-2">
                    <p className="mb-3 text-center text-sm font-semibold text-emerald-600">
                      กำลังสุ่มคู่...
                    </p>
                    <div className="flex items-stretch gap-3">
                      <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 dark:border-emerald-800/60 dark:bg-emerald-950/40">
                        <span
                          key={`a0-${rollTick}`}
                          className="animate-slot-in rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-emerald-800 shadow-sm dark:bg-slate-800 dark:text-emerald-300"
                        >
                          {rollNames[idx]?.[0]}
                        </span>
                        <span
                          key={`a1-${rollTick}`}
                          className="animate-slot-in rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-emerald-800 shadow-sm dark:bg-slate-800 dark:text-emerald-300"
                        >
                          {rollNames[idx]?.[1]}
                        </span>
                      </div>
                      <div className="flex items-center">
                        <span className="flex h-10 w-10 animate-pulse items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 text-sm font-extrabold text-white shadow-md shadow-rose-500/30">
                          VS
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-sky-200 bg-sky-50/60 p-3 dark:border-sky-800/60 dark:bg-sky-950/40">
                        <span
                          key={`b0-${rollTick}`}
                          className="animate-slot-in rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-sky-800 shadow-sm dark:bg-slate-800 dark:text-sky-300"
                        >
                          {rollNames[idx]?.[2]}
                        </span>
                        <span
                          key={`b1-${rollTick}`}
                          className="animate-slot-in rounded-xl bg-white px-3 py-2.5 text-center text-sm font-bold text-sky-800 shadow-sm dark:bg-slate-800 dark:text-sky-300"
                        >
                          {rollNames[idx]?.[3]}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : court.status === "idle" ? (
                  <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/50 px-4 py-8 dark:border-slate-700 dark:bg-slate-800/50">
                    <p className="text-sm font-medium text-slate-400 dark:text-slate-500">
                      ยังไม่มีคู่ — ผู้เล่นว่าง {poolCount} คน
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500">
                      สุ่มคนที่ยังไม่ได้เล่นลงก่อน จากนั้นสุ่มตามจำนวนเกม (เกมน้อยได้ก่อน) และเลี่ยงคู่ซ้ำจากเกมล่าสุด
                    </p>
                    <button
                      onClick={() => shuffleCourt(idx)}
                      disabled={!canShuffle}
                      className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
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
                      <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-emerald-100 p-3 dark:border-emerald-800/60 dark:from-emerald-950/70 dark:to-emerald-900/40">
                              {renderSlot("A", 0, "text-emerald-800 dark:text-emerald-300")}
                        {renderSlot("A", 1, "text-emerald-800 dark:text-emerald-300")}
                      </div>
                      <div className="flex items-center">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-rose-600 text-sm font-extrabold text-white shadow-md shadow-rose-500/30">
                          VS
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col gap-2 rounded-2xl border border-sky-200 bg-gradient-to-br from-sky-50 to-sky-100 p-3 dark:border-sky-800/60 dark:from-sky-950/70 dark:to-sky-900/40">
                        {renderSlot("B", 0, "text-sky-800 dark:text-sky-300")}
                        {renderSlot("B", 1, "text-sky-800 dark:text-sky-300")}
                      </div>
                    </div>

                    {repeat && (
                      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">
                        <span className="text-xs font-semibold text-amber-700">
                          {repeat[0]} × {repeat[1]} เคยเป็นทีมเดียวกับเกมก่อน ๆ
                        </span>
                        <button
                          onClick={() => splitRepeat(idx)}
                          className="rounded-full bg-amber-500 px-3 py-1 text-xs font-bold text-white shadow-sm transition-colors hover:bg-amber-600"
                        >
                          แยกคู่ให้
                        </button>
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                      {court.status === "ready" && (
                        <>
                          <button
                            onClick={() => startCourt(idx)}
                            disabled={!full}
                            className="rounded-xl bg-lime-600 px-6 py-2.5 font-semibold text-white shadow-md shadow-lime-600/25 transition-all hover:-translate-y-0.5 hover:bg-lime-700 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            เริ่มเกม
                          </button>
                          <button
                            onClick={() => shuffleCourt(idx)}
                                                  className="rounded-xl bg-slate-100 px-6 py-2.5 font-semibold text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
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
                            className="rounded-xl bg-rose-600 px-6 py-2.5 font-semibold text-white shadow-md shadow-rose-600/25 transition-all hover:-translate-y-0.5 hover:bg-rose-700"
                          >
                            จบเกม
                          </button>
                        </>
                      )}
                      {court.status === "done" && (
                        <button
                          onClick={() => shuffleCourt(idx)}
                          className="rounded-xl bg-emerald-600 px-6 py-2.5 font-semibold text-white shadow-md shadow-emerald-600/25 transition-all hover:-translate-y-0.5 hover:bg-emerald-700"
                        >
                          สุ่มคู่ใหม่
                        </button>
                      )}
                      <button
                        onClick={() => setSwapCourt(idx)}
                                                        className="rounded-xl bg-sky-100 px-6 py-2.5 font-semibold text-sky-700 transition-colors hover:bg-sky-200 dark:bg-sky-950/80 dark:text-sky-300 dark:hover:bg-sky-900"
                      >
                        เปลี่ยนคน
                      </button>
                    </div>
                  </>
                )}
                </div>
                {swapCourt === idx && (
                  <aside className="flex w-full shrink-0 flex-col rounded-2xl border border-sky-200 bg-sky-50/60 p-3 lg:w-52 dark:border-sky-800/60 dark:bg-sky-950/40">
                    <p className="text-center text-sm font-semibold text-sky-800 dark:text-sky-200">
                      {swapOut
                        ? `แทน "${swapOut}"`
                        : "กดชื่อคนที่ต้องการเปลี่ยน"}
                    </p>
                    {freePlayers.length === 0 ? (
                      <p className="mt-2 text-center text-xs text-sky-600 dark:text-sky-400">
                        ไม่มีคนว่างให้สลับ
                      </p>
                    ) : (
                      <div className="sidebar-scroll mt-2 max-h-72 flex-1 overflow-y-auto pr-1">
                        <div className="flex flex-col gap-1.5">
                          {freePlayers.map((n) => (
                            <button
                              key={n}
                              onClick={() => {
                                if (suppressClickRef.current) return;
                                if (!swapOut) return;
                                doSwap(idx, swapOut, n);
                              }}
                              {...pressHandlers(n, null)}
                              style={{ touchAction: "none" }}
                              className={`cursor-grab select-none rounded-lg bg-white px-3 py-2 text-sm font-semibold shadow-sm transition-all hover:bg-sky-50 dark:bg-slate-800 dark:hover:bg-slate-700 ${
                                dragName === n
                                  ? "scale-105 opacity-60 ring-2 ring-rose-400"
                                  : "text-sky-800 ring-1 ring-sky-200 dark:text-sky-200 dark:ring-sky-700"
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    <p className="mt-2 text-[11px] leading-relaxed text-sky-600 dark:text-sky-400">
                      ลากชื่อจากรายการนี้ไปวางในคอร์ดได้เลย หรือกดชื่อคนในคอร์ดเพื่อสลับข้าง
                    </p>
                    <button
                      onClick={() => {
                        setSwapCourt(null);
                        setSwapOut(null);
                      }}
                      className="mt-2 rounded-full bg-slate-100 px-4 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                    >
                      ✕ ยกเลิก
                    </button>
                  </aside>
                )}
                </div>
              </div>
            );
          })}
        </section>
      </div>

      {ghost && (
        <div
          className="pointer-events-none fixed z-50"
          style={{ left: ghost.x, top: ghost.y }}
        >
          <span className="inline-block -translate-x-1/2 -translate-y-[calc(100%+14px)] whitespace-nowrap rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-bold text-white shadow-xl shadow-emerald-900/30 ring-2 ring-white">
            {ghost.name}
          </span>
        </div>
      )}

      <footer className="mt-8 text-center text-xs text-slate-400 dark:text-slate-500">
        ก๊วน CS KhemKhang · KuanBad
      </footer>
    </main>
  );
}
