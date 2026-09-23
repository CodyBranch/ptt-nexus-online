import { redirect } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import { isAdmin } from '@/lib/admin-auth';

/**
 * Everything under here changes the shared database, so everything under here
 * is behind the sign-in.
 *
 * The gate is on the layout rather than a middleware because it is the layout
 * every one of these pages goes through, and because a middleware that is
 * matched by path is a list somebody has to remember to add a page to. The
 * actions that write check again on their own account — a page being
 * reachable and an action being allowed are two different questions, and a
 * server action is a POST to a URL rather than a page anybody navigated to.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!await isAdmin()) redirect('/login');

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-60">
        <div className="p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
