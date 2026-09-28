import RecordSetForm from '../RecordSetForm';
import { getAnchorOptions } from '../actions';

export const dynamic = 'force-dynamic';

export default async function NewRecordSetPage() {
  const anchors = await getAnchorOptions();
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">New Record Set</h1>
      <RecordSetForm anchors={anchors} />
    </div>
  );
}
