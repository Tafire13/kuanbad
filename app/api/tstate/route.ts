import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const sql = neon(process.env.POSTGRES_URL as string);

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS tournament_state (
      id integer PRIMARY KEY CHECK (id = 1),
      state jsonb NOT NULL,
      rev bigint NOT NULL
    )
  `;
}

export async function GET() {
  try {
    await ensureTable();
    const rows = await sql`
      SELECT state, rev FROM tournament_state WHERE id = 1
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

export async function POST(req: Request) {
  try {
    await ensureTable();
    const body = (await req.json()) as {
      state?: unknown;
      baseRev?: number | null;
    };
    const rows =
      body.baseRev == null
        ? await sql`
            INSERT INTO tournament_state (id, state, rev)
            VALUES (1, ${JSON.stringify(body.state)}::jsonb, ${Date.now()})
            ON CONFLICT (id) DO NOTHING
            RETURNING rev
          `
        : await sql`
            UPDATE tournament_state
            SET state = ${JSON.stringify(body.state)}::jsonb,
                rev = ${Date.now()}
            WHERE id = 1 AND rev = ${body.baseRev}
            RETURNING rev
          `;

    if (rows.length === 0) {
      const cur = await sql`
        SELECT state, rev FROM tournament_state WHERE id = 1
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
