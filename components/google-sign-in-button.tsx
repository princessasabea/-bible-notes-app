"use client";

import { signIn } from "next-auth/react";

export function GoogleSignInButton() {
    return (
        <button onClick={() => signIn("google")}>
            Sign in with Google
        </button>
    );
}
