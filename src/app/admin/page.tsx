import { requireAdminPageAccess } from './_access';

export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const { actor, user } = await requireAdminPageAccess('/admin');
  const roles = actor.isSuperAdmin ? ['Super Admin'] : actor.roles;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as {user.name} ({user.email}).
        </p>
      </div>

      <section
        aria-labelledby="admin-roles-heading"
        className="rounded-xl border border-border bg-card p-4"
      >
        <h2 id="admin-roles-heading" className="text-sm font-semibold text-foreground">
          Your roles
        </h2>
        <RoleList roles={roles} />
      </section>
    </div>
  );
}

function RoleList({ roles }: Readonly<{ roles: readonly string[] }>) {
  if (roles.length === 0) {
    return <p className="mt-2 text-sm text-muted-foreground">No roles assigned.</p>;
  }

  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {roles.map((role) => <li key={role} className="rounded-full bg-muted px-3 py-1 text-xs text-foreground">{role}</li>)}
    </ul>
  );
}
