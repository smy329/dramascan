'use server';

import { requireSuperAdmin } from '@/modules/authorization/guards';
import { db } from '@/db/client';
import { report_submissions } from '@/modules/users/schema';
import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/navigation';
import { redirect } from 'next/navigation';

/** Mark a report as resolved with a status note. */
export async function resolveReportAction(
  reportId: string,
  status: 'reviewed' | 'resolved',
  note: string = ''
) {
  const actor = await requireSuperAdmin({ userId: '', isSuperAdmin: true });

  await db
    .update(report_submissions)
    .set({
      status,
      updated_at: new Date(),
      ...(note !== '' ? { description: note } : {}),
    })
    .where(eq(report_submissions.id, reportId));

  // Revalidate the reports admin page
  revalidatePath('/admin/reports');

  redirect('/admin/reports');

  return { success: true };
}