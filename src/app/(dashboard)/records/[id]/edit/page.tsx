import { notFound } from 'next/navigation';
import { getRecordSet } from '../../actions';
import RecordSetForm from '../../RecordSetForm';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditRecordSetPage({ params }: PageProps) {
  const { id } = await params;
  const recordSet = await getRecordSet(id);

  if (!recordSet) {
    notFound();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Edit Record Set</h1>
      <RecordSetForm recordSet={recordSet} />
    </div>
  );
}
