import { notFound } from 'next/navigation';
import { getRecordSet, getAnchorOptions } from '../../actions';
import RecordSetForm from '../../RecordSetForm';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function EditRecordSetPage({ params }: PageProps) {
  const { id } = await params;
  const [recordSet, anchors] = await Promise.all([getRecordSet(id), getAnchorOptions()]);

  if (!recordSet) {
    notFound();
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Edit Record Set</h1>
      <RecordSetForm recordSet={recordSet} anchors={anchors} />
    </div>
  );
}
