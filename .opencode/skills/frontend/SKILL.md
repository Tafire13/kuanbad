---
name: frontend
description: Use when building or editing frontend UI in this project — React/Next.js pages, Tailwind styling, responsive layouts, Thai-language UI, or anything visual in app/. Triggers on words like frontend, UI, page, component, design, Tailwind, responsive, styling.
---

# Frontend Guidelines

This project is **Next.js 16 (App Router, Turbopack) + React + Tailwind CSS v4 + TypeScript**.

## Core rules

- All interactive UI (state, timers, buttons, localStorage) must be a **client component**: add `"use client";` at the top.
- Server components by default; only add `"use client"` when React state/effects are actually needed.
- Style with **Tailwind utility classes only**. No CSS modules, no inline `style` tags, no custom CSS unless Tailwind cannot express it.
- Use semantic HTML (`main`, `section`, `aside`, `header`, `footer`, `button`, `ul/li`). Use real `<button>` for clickable elements.
- Never hardcode Thai text into separate locale files unless the feature requires i18n — this app is Thai-only.

## Tailwind v4 notes

- Global theme is in `app/globals.css` via `@import "tailwindcss"`.
- The body font stack already includes Thai fonts (`Leelawadee UI`, `Noto Sans Thai`) — keep Thai fallbacks in any custom font-family.
- Use the standard palette (emerald/sky/lime/rose/slate) already used across the app for visual consistency.

## Layout conventions

- Page container: `mx-auto w-full max-w-6xl px-4 py-8 flex-1`.
- Sidebar layout: `flex flex-col gap-6 lg:flex-row` with `lg:w-80 lg:shrink-0` for the aside and `flex-1` for content; make the aside `lg:sticky lg:top-6`.
- Cards: `rounded-2xl bg-white p-5 shadow-sm border border-slate-200`.
- Buttons: primary `bg-emerald-600 text-white`, destructive `bg-rose-600 text-white`, neutral `bg-slate-100 text-slate-600`. Disabled state: `disabled:cursor-not-allowed disabled:opacity-40`.
- Always design mobile-first: base styles for small screens, `sm:`/`lg:` for larger.

## Time/number display

- Live clock format `m:ss` (e.g. `5:23`) via `Math.floor(s / 60)` + `padStart(2, "0")`.
- Thai duration text: `${m} นาที ${s} วินาที`. Use `tabular-nums` on all numeric readouts.
- Store durations as **seconds** in state/localStorage; format only at render time.

## State & persistence

- Persist across reloads with `localStorage` (keys prefixed `kuanbad-*`), guarded by `typeof window === "undefined"` in initializers and try/catch on parse.
- For live ticking timers: keep one `now` state + `setInterval` driven by a `useEffect`, compute elapsed as `now - startAt`; never store "current time" per entity.
- Keep state updates immutable: copy arrays/objects before mutation.

## Accessibility

- Color must not be the only signal: pair status colors with text labels.
- Provide `aria-label` on icon-only buttons.
- Buttons should have visible text in Thai (e.g. `สุ่มคู่`, `เริ่มเกม`, `จบเกม`).

## Verification

- After any change run `npm run build` and fix TypeScript errors before finishing.