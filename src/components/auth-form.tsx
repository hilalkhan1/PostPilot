"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signIn, signUp } from "@/lib/auth-client";
import { LogoMark } from "./logo";

const MIN_PASSWORD = 10;

/**
 * Sign-in and sign-up share a form because they differ by one field and one
 * call. Keeping them together stops the two drifting apart in wording or
 * validation, which is how "password must be 10 characters" ends up stated on
 * one screen and enforced on the other.
 */
export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const isSignUp = mode === "sign-up";

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (isSignUp && password.length < MIN_PASSWORD) {
      setError(`Use at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    const result = isSignUp
      ? await signUp.email({ name: name.trim() || email, email, password })
      : await signIn.email({ email, password });
    setBusy(false);

    if (result.error) {
      setError(
        result.error.message ??
          (isSignUp
            ? "Could not create that account."
            : "That email and password do not match."),
      );
      return;
    }

    router.push("/");
    router.refresh();
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
      <div className="grid gap-2">
        <LogoMark size={36} />
        <h1 className="text-2xl font-bold tracking-tight">
          {isSignUp ? "Create your workspace" : "Sign in to PostPilot"}
        </h1>
        <p className="text-sm text-muted">
          {isSignUp
            ? "Write once, publish everywhere — now or on a schedule."
            : "Welcome back."}
        </p>
      </div>

      <form
        onSubmit={submit}
        className="grid gap-4 rounded-md border border-line bg-surface p-5"
      >
        {isSignUp && (
          <div className="grid gap-1.5">
            <label htmlFor="name" className="eyebrow">
              Name
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              className="w-full rounded border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
        )}

        <div className="grid gap-1.5">
          <label htmlFor="email" className="eyebrow">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="w-full rounded border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </div>

        <div className="grid gap-1.5">
          <label htmlFor="password" className="eyebrow">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            className="w-full rounded border border-line bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
          />
          {isSignUp && (
            <span className="text-xs text-muted">
              At least {MIN_PASSWORD} characters.
            </span>
          )}
        </div>

        {error && (
          <p className="rounded border border-crit bg-crit-soft px-3 py-2 text-xs text-crit">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded bg-accent px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy
            ? "Working…"
            : isSignUp
              ? "Create account"
              : "Sign in"}
        </button>
      </form>

      <p className="text-sm text-muted">
        {isSignUp ? "Already have an account? " : "No account yet? "}
        <Link
          href={isSignUp ? "/sign-in" : "/sign-up"}
          className="text-accent underline"
        >
          {isSignUp ? "Sign in" : "Create one"}
        </Link>
      </p>
    </main>
  );
}
