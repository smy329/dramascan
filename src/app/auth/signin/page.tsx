import { redirect } from 'next/navigation';
import { getActiveSession } from '@/platform/auth/session';
import { googleSignIn } from '@/workflows/auth/google-oauth';

export const dynamic = 'force-dynamic';

type SignInPageProps = {
  searchParams: Promise<{ error?: string }>;
};

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const session = await getActiveSession();
  if (session) {
    redirect('/dashboard');
  }

  const { error } = await searchParams;

  let errorNotice = null;
  if (error) {
    errorNotice = <p
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      Sign-in failed. Please try again.
    </p>;
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full space-y-8 text-center">
        <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-gray-100">
          Sign in to DramaScan
        </h1>

        <p className="mb-6 text-lg text-gray-600 dark:text-gray-300">
          Sign in with your Google account to access the drama streaming platform.
        </p>

        {errorNotice}

        <form action={googleSignIn} className="w-full">
          <button
            type="submit"
            className="w-full rounded-md border border-green-600 bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
          >
            Sign in with Google
          </button>
        </form>
      </div>
    </div>
  );
}
