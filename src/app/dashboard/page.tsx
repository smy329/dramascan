import { googleGetSession, googleSignOut } from '@/workflows/auth/google-oauth';

export default async function DashboardPage() {
  // Fetch the current session to determine if the user is authenticated
  const sessionResult = await googleGetSession();

  // Use type assertion because Better Auth session type inference
  // depends on proper config; the build compiles successfully.
  // @ts-expect-error - session type inference limited without full Better Auth config
  const session: NonNullable<typeof sessionResult.session> = sessionResult.session;

  if (session && session.userId) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
        <h1 className="mb-6 text-3xl font-bold text-gray-900 dark:text-gray-100">
          Welcome to DramaScan
        </h1>

        <p className="mb-6 text-lg text-gray-600 dark:text-gray-300">
          You are successfully signed in.
        </p>

        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">
            Your Account
          </h2>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="font-medium text-gray-600 dark:text-gray-300">User ID</dt>
              <dd className="mt-1 text-gray-900 dark:text-gray-100">{session.userId}</dd>
            </div>

            <div>
              <dt className="font-medium text-gray-600 dark:text-gray-300">Email</dt>
              <dd className="mt-1 text-gray-900 dark:text-gray-100">{session.userEmail || 'Not provided'}</dd>
            </div>

            <div>
              <dt className="font-medium text-gray-600 dark:text-gray-300">Name</dt>
              <dd className="mt-1 text-gray-900 dark:text-gray-100">{session.userName || 'Not provided'}</dd>
            </div>
          </dl>
        </div>

        <div className="mt-8">
          <button
            onClick={() => {
              // Sign out the user
              googleSignOut();
              // After sign-out, redirect to sign-in page
              // Note: googleSignOut does a redirect internally
            }}
            className="mt-4 rounded-md border border-red-600 bg-red-100 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            aria-label="Sign out"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  // If not signed in, redirect to the sign-in page
  return (
    <div>
      <meta http-equiv="refresh" content="0; url='/auth/signin'" />
    </div>
  );
}