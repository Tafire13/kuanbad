import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const sql = neon(process.env.POSTGRES_URL as string);

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS kuanbad_group_state (
      code TEXT PRIMARY KEY,
      state jsonb NOT NULL,
      rev bigint NOT NULL
    )
  `;
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  try {
    await ensureTable();
    const { code } = await ctx.params;
    const rows = await sql`
      SELECT state, rev FROM kuanbad_group_state WHERE code = ${code}
    `;
    if (rows.length === 0) {
      return NextResponse.json({ state: null, rev: null });
    }
    return NextResponse.json({
      state: rows[0].state,
      rev: Number(rows[0].rev),
    });
  } catch {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  try {
    await ensureTable();
    const { code } = await ctx.params;
    const body = (await req.json()) as {
      state?: unknown;
      baseRev?: number | null;
    };
    const rows =
      body.baseRev == null
        ? await sql`
            INSERT INTO kuanbad_group_state (code, state, rev)
            VALUES (${code}, ${JSON.stringify(body.state)}::jsonb, ${Date.now()})
            ON CONFLICT (code) DO NOTHING
            RETURNING rev
          `
        : await sql`
            UPDATE kuanbad_group_state
            SET state = ${JSON.stringify(body.state)}::jsonb,
                rev = ${Date.now()}
            WHERE code = ${code} AND rev = ${body.baseRev}
            RETURNING rev
          `;

    if (rows.length === 0) {
      const cur = await sql`
        SELECT state, rev FROM kuanbad_group_state WHERE code = ${code}
      `;
      return NextResponse.json(
        {
          error: "conflict",
          state: cur.length ? cur[0].state : null,
          rev: cur.length ? Number(cur[0].rev) : null,
        },
        { status: 409 }
      );
    }
    return NextResponse.json({
      state: body.state,
      rev: Number(rows[0].rev),
    });
  } catch {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
