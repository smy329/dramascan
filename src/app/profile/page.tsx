import { redirect } from 'next/navigation';
import { getActiveSession } from '@/platform/auth/session';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await getActiveSession();

  if (!session) {
    redirect('/auth/signin');
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-8">
      <div className="max-w-2xl mx-auto">
        {/* Avatar and name */}
        <div className="text-center mb-8">
          {session.userName ? (
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-2xl text-white">
              {session.userName?.charAt(0)}
            </div>
          ) : (
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-indigo-600 to-purple-600 flex items-center justify-center text-2xl text-white">
              {session.userName?.charAt(0) || 'U'}
            </div>
          )}

          <h1 className="mb-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
            {session.userName}
          </h1>

          <p className="text-gray-500 dark:text-gray-400">
            {session.userEmail || 'No email verified'}
          </p>
        </div>

        {/* Account info section */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow mb-8">
          <h2 className="font-semibold text-gray-900 dark:text-gray-100 mb-4">Account Information</h2>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="font-medium text-gray-600 dark:text-gray-300">User ID</dt>
              <dd className="mt-1 text-gray-900 dark:text-gray-100">{session.userId}</dd>
            </div>

            <div>
              <dt className="font-medium text-gray-600 dark:text-gray-300">Email</dt>
              <dd className="mt-1 text-gray-900 dark:text-gray-100">
                {session.userEmail || 'Not provided'}
              </dd>
            </div>

            <div>
              <dt className="font-medium text-gray-600 dark:text-gray-300">Member Since</dt>
              <dd className="mt-1 text-gray-900 dark:text-gray-100">
                {new Date().toLocaleDateString()}
              </dd>
            </div>
          </dl>
        </div>

        {/* Personalized features */}
        <div className="space-y-4">
          <nav className="flex flex-col sm:flex-row gap-3">
            <a
              href="/bookmarks"
              className="flex-1 rounded-md border border-blue-600 bg-blue-100 px-4 py-2 text-sm font-medium text-blue-600 hover:bg-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              My Bookmarks
            </a>

            <a
              href="/continue-watching"
              className="flex-1 rounded-md border border-green-600 bg-green-100 px-4 py-2 text-sm font-medium text-green-600 hover:bg-green-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2"
            >
              Continue Watching
            </a>

            <a
              href="/watch-history"
              className="flex-1 rounded-md border border-purple-600 bg-purple-100 px-4 py-2 text-sm font-medium text-purple-600 hover:bg-purple-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 focus-visible:ring-offset-2"
            >
              Watch History
            </a>
          </nav>
        </div>
      </div>
    </div>
  );
}