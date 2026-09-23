import { getTagTree } from './actions';
import TagTree from './TagTree';

export const dynamic = 'force-dynamic';

export default async function TagsPage() {
  const tree = await getTagTree();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Tags</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">
          How a school is classified, as things a meet can filter by — College, NCAA DI,
          SEC; High School, MSHSAA, Class 1. The levels, divisions and conferences here
          were built from what the organisations already carried. Classes were not:
          nothing in the data says which class a school is in, so they go on from here.
        </p>
      </div>

      <TagTree tree={tree} />
    </div>
  );
}
