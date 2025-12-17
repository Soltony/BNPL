import { getUserFromSession } from '@/lib/user';

export async function requireBranchOrAdmin() {
  const user = await getUserFromSession();
  if (!user?.id) throw new Error('Unauthorized');
  const isAdmin = user.role === 'Super Admin';
  const hasBranchPerm = !!user.permissions?.branch;
  if (!isAdmin && !hasBranchPerm) throw new Error('Unauthorized');
  return user;
}

export async function requireBranchOrAdminFromRequest() {
  // kept for compatibility; delegates to requireBranchOrAdmin
  return requireBranchOrAdmin();
}
