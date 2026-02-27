import { NextResponse } from "next/server";
import { Pool } from "pg";

export async function GET() {
    try {
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });

        // This tries to perform a simple query to the database
        const client = await pool.connect();
        const result = await client.query("SELECT NOW()");
        client.release();

        return NextResponse.json({ status: "Database connection successful!", time: result.rows[0] });
    } catch (error: any) {
        // This will force the specific error message to appear in your browser
        return NextResponse.json({ error: error.message, stack: error.stack }, { status: 500 });
    }
}
