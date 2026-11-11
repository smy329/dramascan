'use client';

import Link from 'next/link';
import { ChevronRight, Menu } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DialogTrigger } from '@/components/ui/dialog';
import { AdminAccountMenu } from './admin-account-menu';
import type { AdminBreadcrumb } from './breadcrumbs';
import type { AdminShellUser } from './admin-shell';

type AdminHeaderProps = Readonly<{
  breadcrumbs: readonly AdminBreadcrumb[];
  user: AdminShellUser;
}>;

export function AdminHeader({ breadcrumbs, user }: AdminHeaderProps) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Open navigation"
          />
        }
      >
        <Menu aria-hidden="true" className="size-5" />
      </DialogTrigger>

      <Breadcrumbs breadcrumbs={breadcrumbs} />

      <div className="ml-auto flex min-w-0 items-center gap-2">
        <AdminAccountMenu user={user} />
      </div>
    </header>
  );
}

type BreadcrumbsProps = Readonly<{ breadcrumbs: readonly AdminBreadcrumb[] }>;

function Breadcrumbs({ breadcrumbs }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-1.5 text-sm">
        {breadcrumbs.map((crumb, index) => {
          const separator = index > 0 ? <CrumbSeparator /> : null;

          return (
            <li
              key={`${crumb.href ?? 'current'}-${index}`}
              className="flex min-w-0 items-center gap-1.5"
            >
              {separator}
              <BreadcrumbEntry crumb={crumb} />
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function CrumbSeparator() {
  return (
    <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
  );
}

type BreadcrumbEntryProps = Readonly<{ crumb: AdminBreadcrumb }>;

/** Known ancestors are links; the current page is plain text. */
function BreadcrumbEntry({ crumb }: BreadcrumbEntryProps) {
  if (crumb.href) {
    return (
      <Link
        href={crumb.href}
        className="truncate text-muted-foreground transition-colors hover:text-foreground"
      >
        {crumb.label}
      </Link>
    );
  }

  return (
    <span aria-current="page" className="truncate font-medium text-foreground">
      {crumb.label}
    </span>
  );
}
