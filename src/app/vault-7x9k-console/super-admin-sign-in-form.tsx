'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  superAdminCredentialsSchema,
  type SuperAdminCredentials,
} from '@/workflows/auth/super-admin-credentials';
import { signInSuperAdmin } from '@/workflows/auth/super-admin-sign-in';

type SuperAdminSignInFormProps = {
  callbackUrl: string;
};

/**
 * Super Admin credential form.
 *
 * Client validation is convenience only: the Server Action re-validates and
 * Better Auth is the authority. Failures always render the same message so the
 * form cannot be used to enumerate accounts.
 */
export function SuperAdminSignInForm({ callbackUrl }: SuperAdminSignInFormProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SuperAdminCredentials>({
    resolver: zodResolver(superAdminCredentialsSchema),
    defaultValues: { email: '', password: '' },
    mode: 'onSubmit',
  });

  const onSubmit = handleSubmit(async values => {
    setServerError(null);
    const formData = new FormData();
    formData.set('email', values.email);
    formData.set('password', values.password);
    formData.set('callbackUrl', callbackUrl);

    const result = await signInSuperAdmin(formData);
    if (result && !result.ok) {
      setServerError(result.message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-4">
      {serverError ? <p
        role="alert"
        className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
      >
        {serverError}
      </p> : null}

      <div className="space-y-1.5">
        <label
          htmlFor="super-admin-email"
          className="block text-sm font-medium text-gray-800 dark:text-gray-200"
        >
          Email
        </label>
        <Input
          id="super-admin-email"
          type="email"
          autoComplete="username"
          autoFocus
          aria-invalid={errors.email ? true : undefined}
          aria-describedby={errors.email ? 'super-admin-email-error' : undefined}
          className="h-10 bg-white"
          {...register('email')}
        />
        {errors.email ? <p id="super-admin-email-error" className="text-sm text-red-600 dark:text-red-400">
            Enter a valid email address.
          </p> : null}
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="super-admin-password"
          className="block text-sm font-medium text-gray-800 dark:text-gray-200"
        >
          Password
        </label>
        <Input
          id="super-admin-password"
          type="password"
          autoComplete="current-password"
          aria-invalid={errors.password ? true : undefined}
          aria-describedby={errors.password ? 'super-admin-password-error' : undefined}
          className="h-10 bg-white"
          {...register('password')}
        />
        {errors.password ? <p id="super-admin-password-error" className="text-sm text-red-600 dark:text-red-400">
            Enter your password.
          </p> : null}
      </div>

      <Button
        type="submit"
        disabled={isSubmitting}
        aria-busy={isSubmitting}
        className="h-10 w-full bg-green-600 text-white hover:bg-green-700"
      >
        {isSubmitting ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  );
}
