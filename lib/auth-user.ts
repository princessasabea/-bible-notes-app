import { auth } from "@/auth";
import { query } from "@/lib/db";

type UserRow = { id: string };

export async function requireUserId(): Promise<string> {
  const session = await auth();

  if (session?.user?.id) {
    return session.user.id;
  }

  // Fallback for cases where adapter/session payload omits user.id but includes email.
  const email = session?.user?.email;
  if (email) {
    const rows = await query<UserRow>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    if (rows[0]?.id) {
      return rows[0].id;
    }
  }

  throw new Error("Unauthorized");
}
