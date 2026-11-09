import { googleSignIn } from '@/workflows/auth/google-oauth';

export default function SignInPage() {
  // Handle Google sign-in click
  const handleSignIn = async () => {
    await googleSignIn();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50 dark:bg-gray-900">
      <div className="max-w-md w-full space-y-8 text-center">
        <h2 className="mt-4 text-3xl font-bold text-gray-900 dark:text-gray-100">
          Sign in to DramaScan
        </h2>

        <p className="mb-6 text-lg text-gray-600 dark:text-gray-300">
          Sign in with your Google account to access the drama streaming platform.
        </p>

        <div className="w-full">
          <button
            onClick={handleSignIn}
            className="w-full rounded-md border border-green-600 bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Sign in with Google"
          >
            Sign in with Google
          </button>
        </div>
      </div>
    </div>
  );
}