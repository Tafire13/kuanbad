import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const sql = neon(process.env.POSTGRES_URL as string);

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS kuanbad_groups (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `;
}

function randomCode() {
  let out = "";
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

export async function GET() {
  try {
    await ensureTable();
    const rows = await sql`
      SELECT code, name, created_at FROM kuanbad_groups
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return NextResponse.json({
      groups: rows.map((r) => ({
        code: r.code,
        name: r.name,
        createdAt: Number(r.created_at),
      })),
    });
  } catch {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureTable();
    const body = (await req.json()) as { name?: string };
    const name = (body.name ?? "").trim().slice(0, 40);
    if (!name) {
      return NextResponse.json({ error: "bad_request" }, { status: 400 });
    }
    let code = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      code = randomCode();
      const rows = await sql`
        INSERT INTO kuanbad_groups (code, name, created_at)
        VALUES (${code}, ${name}, ${Date.now()})
        ON CONFLICT (code) DO NOTHING
        RETURNING code
      `;
      if (rows.length > 0) {
        return NextResponse.json({ code, name });
      }
    }
    return NextResponse.json({ error: "retry" }, { status: 500 });
  } catch {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
