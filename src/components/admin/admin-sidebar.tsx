'use client';

import Link from 'next/link';
import {
  BarChart3,
  Bell,
  Circle,
  Clapperboard,
  FileText,
  Film,
  LayoutDashboard,
  ListVideo,
  MessageSquare,
  MonitorPlay,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Tags,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { isAdminNavItemActive, type AdminNavGroup } from './navigation';

const ENTRY_ICONS: Record<string, LucideIcon> = {
  overview: LayoutDashboard,
  dramas: Film,
  movies: Clapperboard,
  episodes: ListVideo,
  categories: Tags,
  platforms: MonitorPlay,
  reports: ShieldAlert,
  reviews: MessageSquare,
  users: Users,
  analytics: BarChart3,
  notifications: Bell,
  settings: Settings,
  roles: ShieldCheck,
  'information-pages': FileText,
};

type AdminSidebarProps = Readonly<{
  navigation: readonly AdminNavGroup[];
  pathname: string;
}>;

export function AdminSidebar({ navigation, pathname }: AdminSidebarProps) {
  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-border bg-card lg:flex">
        <div className="flex h-14 items-center border-b border-border px-4">
          <Brand />
        </div>
        <SidebarNavigation navigation={navigation} pathname={pathname} label="Admin" />
      </aside>

      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/60 backdrop-blur-sm"
        className="top-0 left-0 flex h-dvh w-72 max-w-[calc(100vw-3rem)] translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0 ring-0 sm:max-w-[calc(100vw-3rem)] data-open:zoom-in-100 data-closed:zoom-out-100 data-open:slide-in-from-left-full data-closed:slide-out-to-left-full"
      >
        <DialogTitle className="sr-only">Admin navigation</DialogTitle>
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <Brand />
          <DialogClose
            render={<Button variant="ghost" size="icon" aria-label="Close navigation" />}
          >
            <X aria-hidden="true" />
          </DialogClose>
        </div>
        <SidebarNavigation
          navigation={navigation}
          pathname={pathname}
          label="Admin navigation"
        />
      </DialogContent>
    </>
  );
}

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2 text-foreground">
      <Clapperboard aria-hidden="true" className="size-5 text-primary" />
      <span className="font-heading text-sm font-semibold">DramaScan Admin</span>
    </Link>
  );
}

type SidebarNavigationProps = Readonly<{
  navigation: readonly AdminNavGroup[];
  pathname: string;
  label: string;
}>;

function SidebarNavigation({ navigation, pathname, label }: SidebarNavigationProps) {
  return (
    <nav aria-label={label} className="flex-1 overflow-y-auto p-3">
      {navigation.map((group) => <SidebarGroup key={group.id} group={group} pathname={pathname} />)}
    </nav>
  );
}

type SidebarGroupProps = Readonly<{
  group: AdminNavGroup;
  pathname: string;
}>;

function SidebarGroup({ group, pathname }: SidebarGroupProps) {
  return (
    <div className="pb-2">
      <p className="px-3 pt-3 pb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {group.label}
      </p>
      <ul className="space-y-1">
        {group.entries.map((entry) => {
          const isActive = isAdminNavItemActive(pathname, entry.href);
          const Icon = ENTRY_ICONS[entry.id] ?? Circle;

          return (
            <li key={entry.id}>
              <Link
                href={entry.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50',
                  isActive && 'bg-muted text-foreground'
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {entry.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
