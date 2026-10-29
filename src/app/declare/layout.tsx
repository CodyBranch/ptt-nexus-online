import KioskOffline from './KioskOffline';

/**
 * Every declare page: the coach form, the dashboard, the clerks' page and the
 * rest. Only adds the meet tablet's offline banner, which is nothing at all
 * outside the PTT Nexus Tablet app.
 */
export default function DeclareLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <KioskOffline />
    </>
  );
}
