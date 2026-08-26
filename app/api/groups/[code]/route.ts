import { neon } from "@neondatabase/serverless";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const sql = neon(process.env.POSTGRES_URL as string);

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ code: string }> }
) {
  try {
    const { code } = await ctx.params;
    const rows = await sql`
      SELECT code, name, created_at FROM kuanbad_groups WHERE code = ${code}
    `;
    if (rows.length === 0) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    return NextResponse.json({
      code: rows[0].code,
      name: rows[0].name,
      createdAt: Number(rows[0].created_at),
    });
  } catch {
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
