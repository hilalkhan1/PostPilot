import { AuthForm } from "@/components/auth-form";

export const metadata = { title: "Create account · PostPilot" };

export default function SignUp() {
  return <AuthForm mode="sign-up" />;
}
