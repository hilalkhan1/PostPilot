"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={async () => {
        await signOut();
        router.push("/sign-in");
        router.refresh();
      }}
      className="text-xs text-muted underline hover:text-accent"
    >
      Sign out
    </button>
  );
}
