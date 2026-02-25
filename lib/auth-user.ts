import { auth } from "@/auth";
import { query } from "@/lib/db";

type UserRow = { id: string };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function requireUserId(): Promise<string> {
  const session = await auth();
  const sessionUserId = session?.user?.id;

  if (sessionUserId && UUID_PATTERN.test(sessionUserId)) {
    return sessionUserId;
  }

  if (sessionUserId && process.env.NODE_ENV === "development") {
    console.error("auth_user_id_not_uuid", { sessionUserId });
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
