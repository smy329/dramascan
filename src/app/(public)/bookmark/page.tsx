import Link from 'next/link';
import { Bookmark, LogIn } from 'lucide-react';

import { EmptyState, PageHeader, PublicPageLayout } from '@/components/public/Layout';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function BookmarkPage() {
  return (
    <PublicPageLayout title="Bookmark">
      <div className="space-y-10">
        <PageHeader
          eyebrow="Your library"
          title="Bookmarks"
          description="Save a series or film to come back to it later. Bookmarks follow your account, so they are available on any device you sign in from."
        />

        <EmptyState
          icon={Bookmark}
          title="No bookmarks yet"
          description="Sign in with Google to keep a saved list. You can remove a bookmark at any time."
        >
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/auth/signin"
              className={cn(buttonVariants({ variant: 'default', size: 'sm' }), 'gap-2')}
            >
              <LogIn className="size-3.5" aria-hidden="true" />
              Sign in
            </Link>
            <Link
              href="/drama"
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              Browse dramas
            </Link>
          </div>
        </EmptyState>
      </div>
    </PublicPageLayout>
  );
}
