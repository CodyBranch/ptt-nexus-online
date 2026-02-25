import { notFound } from 'next/navigation';
import { getOrganization } from '../actions';
import OrganizationForm from '../OrganizationForm';
import type { OrganizationRow } from '@/types';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditOrganizationPage({ params }: PageProps) {
  const { id } = await params;
  const organization = await getOrganization(id);

  if (!organization) {
    notFound();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Edit Organization</h1>
      <OrganizationForm organization={organization as OrganizationRow} />
    </div>
  );
}
