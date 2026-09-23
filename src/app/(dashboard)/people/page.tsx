import { getPeople } from './actions';
import PeopleList from './PeopleList';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

export default async function PeoplePage() {
  const me = await requireAdmin();
  const people = await getPeople();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">People</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">
          Who can sign in. Revoking somebody takes effect at once, even if they are
          signed in — the cookie only says who they are, and whether they are still
          allowed is looked up on every request.
        </p>
      </div>

      {me.bootstrap && (
        <div className="mb-4 px-4 py-3 bg-amber-500/10 border border-amber-500/30 rounded text-sm text-amber-300">
          You are signed in with the server&rsquo;s ADMIN_PASSWORD rather than an account.
          That is the way in when nobody can sign in — the first deploy, or the day the
          last account is switched off by mistake. Add yourself an account and use it.
        </div>
      )}

      <PeopleList
        people={people}
        canManage={me.role === 'admin'}
        meId={me.userId}
      />
    </div>
  );
}
