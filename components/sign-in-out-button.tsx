import { signOut } from "@/auth";
import { GoogleSignInButton } from "./google-sign-in-button";

export function SignInOutButton({ email }: { email: string | null }): React.ReactElement {
  return email ? (
    <form
      className="auth-form"
      action={async () => {
        "use server";
        await signOut();
      }}
    >
      <span className="signed-in-email">{email}</span>
      <button type="submit" className="ghost-button">Sign out</button>
    </form>
  ) : (
    <GoogleSignInButton />
  );
}
