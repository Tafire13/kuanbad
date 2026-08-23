import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const sql = neon(process.env.POSTGRES_URL as string);

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS app_state (
      id integer PRIMARY KEY CHECK (id = 1),
      state jsonb NOT NULL,
      updated_at bigint NOT NULL
    )
  `;
  const cols = await sql`
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'app_state' AND column_name = 'updated_at'
  `;
  if (cols[0]?.data_type !== "bigint") {
    await sql`
      ALTER TABLE app_state ALTER COLUMN updated_at DROP DEFAULT
    `;
    await sql`
      ALTER TABLE app_state
      ALTER COLUMN updated_at TYPE bigint
      USING (extract(epoch from updated_at) * 1000)::bigint
    `;
  }
}

export async function GET() {
  try {
    await ensureTable();
    const rows = await sql`
      SELECT state, updated_at FROM app_state WHERE id = 1
    `;
    if (rows.length === 0) {
      return NextResponse.json({ state: null, rev: null });
    }
    return NextResponse.json({
      state: rows[0].state,
      rev: rows[0].updated_at,
    });
  } catch {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await ensureTable();
    const body = (await req.json()) as {
      state: unknown;
      baseRev: number | null;
    };
    const { state, baseRev } = body;

    const rows =
      baseRev == null
        ? await sql`
            INSERT INTO app_state (id, state, updated_at)
            VALUES (1, ${JSON.stringify(state)}::jsonb, (extract(epoch from now()) * 1000)::bigint)
            ON CONFLICT (id) DO NOTHING
            RETURNING updated_at
          `
        : await sql`
            UPDATE app_state
            SET state = ${JSON.stringify(state)}::jsonb,
                updated_at = (extract(epoch from now()) * 1000)::bigint
            WHERE id = 1 AND updated_at = ${baseRev}
            RETURNING updated_at
          `;

    if (rows.length === 0) {
      const cur = await sql`
        SELECT state, updated_at FROM app_state WHERE id = 1
      `;
      return NextResponse.json(
        {
          error: "conflict",
          state: cur.length ? cur[0].state : null,
          rev: cur.length ? cur[0].updated_at : null,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      state,
      rev: rows[0].updated_at,
    });
  } catch {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}