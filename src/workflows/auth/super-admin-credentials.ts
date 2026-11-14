/**
 * Super Admin credential validation (framework-free).
 *
 * Shared by the client form and the Server Action so both apply the same
 * rules. Login accepts any non-empty password: the length policy belongs to
 * credential creation (the seed script), and rejecting short passwords here
 * would disclose that policy to anyone probing the form.
 */

import { z } from 'zod';

export const superAdminCredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1),
});

export type SuperAdminCredentials = z.infer<typeof superAdminCredentialsSchema>;
