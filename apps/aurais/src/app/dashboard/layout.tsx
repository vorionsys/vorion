import DashboardSidebar from '@/components/dashboard-sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <DashboardSidebar />
      <main className="ml-64 p-8">{children}</main>
    </div>
  )
}
