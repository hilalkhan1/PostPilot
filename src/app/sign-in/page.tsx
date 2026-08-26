import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Sign in · PostPilot" };

export default function SignIn() {
  return <AuthForm mode="sign-in" />;
}
